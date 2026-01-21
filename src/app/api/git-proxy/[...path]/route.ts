import { type NextRequest } from "next/server"
import { log } from "@/lib/logger"
import { prisma } from "@/lib/db"
import { authenticateGitRequest, validateRepoAccess, validateBranchAccess } from "@/lib/auth/git-auth"
import { parseRepoFromPath } from "@/lib/git/parse"
import { extractBranchesFromPack } from "@/lib/git/pack-parser"
import { getGitHubAppConfig } from "@/lib/github/app-config"
import { getInstallationToken } from "@/lib/github/token"

/**
 * Git Proxy API Route
 *
 * Proxies Git Smart HTTP requests to GitHub, authenticating via GitHub App
 * installation tokens. Sessions can only access repos declared in their
 * sources/outcomes configuration.
 *
 * LIMITATION: Branch-level access control only applies to WRITE operations.
 * Read operations (clone/fetch) have repo-level access - if a session can
 * read a repo, it can read ALL branches. This is because Git's protocol
 * advertises all refs in info/refs, and filtering would require intercepting
 * and modifying GitHub's response (complex, with edge cases around shared
 * commits between branches). Branch protection for reads could be added
 * later by filtering the info/refs response.
 */

type GitOperation = "read" | "write"

function getGitOperation(request: NextRequest, path: string): GitOperation {
  // git-receive-pack is for push operations (write)
  // git-upload-pack is for fetch/clone operations (read)
  if (path.endsWith("/git-receive-pack") || request.nextUrl.searchParams.get("service") === "git-receive-pack") {
    return "write"
  }
  return "read"
}

async function proxyToGitHub(
  request: NextRequest,
  owner: string,
  repo: string,
  gitHubPath: string,
  installationToken: string,
  body: ArrayBuffer | null
): Promise<Response> {
  const url = `https://github.com/${owner}/${repo}.git/${gitHubPath}`

  const headers = new Headers()
  // GitHub's git smart HTTP requires Basic auth with x-access-token as username
  const basicAuth = Buffer.from(`x-access-token:${installationToken}`).toString("base64")
  headers.set("Authorization", `Basic ${basicAuth}`)
  headers.set("User-Agent", "agent-quickstart-git-proxy")

  // Forward relevant headers
  const contentType = request.headers.get("content-type")
  if (contentType) {
    headers.set("Content-Type", contentType)
  }

  const accept = request.headers.get("accept")
  if (accept) {
    headers.set("Accept", accept)
  }

  const response = await fetch(url, {
    method: request.method,
    headers,
    body: body,
  })

  // Forward response headers
  const responseHeaders = new Headers()
  response.headers.forEach((value, key) => {
    // Skip hop-by-hop headers
    if (!["connection", "keep-alive", "transfer-encoding"].includes(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

function errorResponse(status: number, message: string): Response {
  const headers: Record<string, string> = { "Content-Type": "text/plain" }

  // For 401 responses, include WWW-Authenticate header so git knows to use Basic auth
  if (status === 401) {
    headers["WWW-Authenticate"] = 'Basic realm="Git Proxy"'
  }

  return new Response(message + "\n", {
    status,
    headers,
  })
}

async function handleGitRequest(request: NextRequest, pathSegments: string[]): Promise<Response> {
  // Reconstruct path from segments
  const path = "/" + pathSegments.join("/")

  // Parse owner/repo from path
  const parsed = parseRepoFromPath(path)
  if (!parsed) {
    log.warn({ path }, "Git proxy: invalid repository path")
    return errorResponse(400, "Invalid repository path")
  }

  const { owner, repo } = parsed

  // Authenticate request
  const auth = await authenticateGitRequest(request)
  if (auth.type === "git_unauthorized") {
    log.warn({ owner, repo, reason: auth.reason }, "Git proxy: unauthorized")
    return errorResponse(401, "Authentication required")
  }

  const { sessionId, userId, payload } = auth

  // Determine operation type
  const operation = getGitOperation(request, path)

  // Validate repo access using JWT scopes
  if (!validateRepoAccess(payload, owner, repo, operation)) {
    log.warn({ sessionId, owner, repo, operation }, "Git proxy: repo access denied")
    return errorResponse(403, "Repository access denied")
  }

  // For write operations, validate branch access
  // NOTE: Branch validation only applies to writes. See file header comment for details.
  let body: ArrayBuffer | null = null
  if (request.method === "POST") {
    body = await request.arrayBuffer()

    if (operation === "write" && body.byteLength > 0) {
      const branches = extractBranchesFromPack(Buffer.from(body))

      for (const branch of branches) {
        if (!validateBranchAccess(payload, branch)) {
          log.warn({ sessionId, owner, repo, branch }, "Git proxy: branch access denied")
          return errorResponse(403, `Push to branch '${branch}' denied`)
        }
      }

      log.info({ sessionId, owner, repo, branches }, "Git proxy: push authorized")
    }
  }

  // Get GitHub App config
  const appConfig = await getGitHubAppConfig()
  if (!appConfig) {
    log.error("Git proxy: GitHub App not configured")
    return errorResponse(500, "GitHub integration not configured")
  }

  // Get user's installation ID
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubInstallationId: true },
  })

  if (!user?.githubInstallationId) {
    log.warn({ userId }, "Git proxy: user has no GitHub installation")
    return errorResponse(403, "GitHub not connected for this user")
  }

  // Get installation token
  let installationToken: string
  try {
    installationToken = await getInstallationToken(appConfig.appId, appConfig.privateKey, user.githubInstallationId)
  } catch (err) {
    log.error({ err: (err as Error).message, userId }, "Git proxy: failed to get installation token")
    return errorResponse(500, "Failed to authenticate with GitHub")
  }

  // Determine the path to forward to GitHub
  // Remove owner/repo prefix to get the git-specific path (info/refs, git-upload-pack, etc.)
  const gitHubPath = path.replace(`/${owner}/${repo}`, "").replace(/^\//, "") || "info/refs"

  // Add query string for info/refs
  const finalPath = request.nextUrl.search ? gitHubPath + request.nextUrl.search : gitHubPath

  log.debug({ sessionId, owner, repo, operation, gitHubPath: finalPath }, "Git proxy: forwarding to GitHub")

  return proxyToGitHub(request, owner, repo, finalPath, installationToken, body)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params
  return handleGitRequest(request, path)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params
  return handleGitRequest(request, path)
}
