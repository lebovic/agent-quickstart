import { verifySessionJwt, type SessionJwtPayload } from "@/lib/auth/jwt"
import { prisma } from "@/lib/db"
import { sessionIdToUuid } from "@/lib/id"

export type GitAuthResult =
  | { type: "git_authorized"; sessionId: string; userId: string; payload: SessionJwtPayload }
  | { type: "git_unauthorized"; reason: string }

/**
 * Extracts JWT from Git HTTP Basic Auth.
 * Git clients send: username=x-access-token, password=<jwt>
 */
function extractJwtFromBasicAuth(request: Request): string | null {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Basic ")) {
    return null
  }

  try {
    const decoded = atob(authHeader.slice(6))
    const colonIndex = decoded.indexOf(":")
    if (colonIndex === -1) {
      return null
    }

    const username = decoded.slice(0, colonIndex)
    const password = decoded.slice(colonIndex + 1)

    if (username !== "x-access-token" || !password) {
      return null
    }

    return password
  } catch {
    return null
  }
}

/**
 * Authenticates a Git HTTP request.
 * Extracts JWT from Basic Auth, verifies it, looks up session and user.
 * Returns the JWT payload containing repo/branch scopes.
 */
export async function authenticateGitRequest(request: Request): Promise<GitAuthResult> {
  const token = extractJwtFromBasicAuth(request)

  if (!token) {
    return { type: "git_unauthorized", reason: "no_credentials" }
  }

  const payload = verifySessionJwt(token)
  if (!payload) {
    return { type: "git_unauthorized", reason: "invalid_jwt" }
  }

  // Convert tagged session ID to UUID
  let sessionUuid: string
  try {
    sessionUuid = sessionIdToUuid(payload.session_id)
  } catch {
    return { type: "git_unauthorized", reason: "invalid_session_id" }
  }

  // Look up session to get user and verify session is active
  const session = await prisma.session.findUnique({
    where: { id: sessionUuid },
    select: { id: true, userId: true, status: true },
  })

  if (!session) {
    return { type: "git_unauthorized", reason: "session_not_found" }
  }

  if (!session.userId) {
    return { type: "git_unauthorized", reason: "session_no_user" }
  }

  if (session.status === "archived" || session.status === "failed") {
    return { type: "git_unauthorized", reason: "session_inactive" }
  }

  return {
    type: "git_authorized",
    sessionId: session.id,
    userId: session.userId,
    payload,
  }
}

/**
 * Validates that a JWT has access to a repository.
 * Read access: repo must be in repos.read OR repos.write
 * Write access: repo must be in repos.write only
 */
export function validateRepoAccess(payload: SessionJwtPayload, owner: string, repo: string, operation: "read" | "write"): boolean {
  const repoFullName = `${owner}/${repo}`.toLowerCase()

  // Check write repos (allows both read and write)
  for (const writeRepo of payload.repos.write) {
    if (writeRepo.toLowerCase() === repoFullName) {
      return true
    }
  }

  // For read operations, also check read repos
  if (operation === "read") {
    for (const readRepo of payload.repos.read) {
      if (readRepo.toLowerCase() === repoFullName) {
        return true
      }
    }
  }

  return false
}

/**
 * Validates that a JWT can push to a specific branch.
 * The branch must be listed in the JWT's branches array.
 */
export function validateBranchAccess(payload: SessionJwtPayload, branch: string): boolean {
  return payload.branches.includes(branch)
}
