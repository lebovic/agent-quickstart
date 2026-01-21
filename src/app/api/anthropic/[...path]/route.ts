import { config } from "@/config"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { verifySessionJwt, extractJwtFromRequest } from "@/lib/auth/jwt"
import { decrypt } from "@/lib/crypto/encryption"
import { sessionIdToUuid } from "@/lib/id"

type AuthResult = { type: "jwt"; sessionId: string } | { type: "unauthorized"; reason: string }

function getAuth(request: Request): AuthResult {
  const token = extractJwtFromRequest(request)
  if (!token) {
    return { type: "unauthorized", reason: "no_token" }
  }

  const payload = verifySessionJwt(token)
  if (!payload) {
    return { type: "unauthorized", reason: "invalid_token" }
  }

  return { type: "jwt", sessionId: payload.session_id }
}

/**
 * Gets the API key to use for a session based on its providerMode.
 * - hosted: Uses server's API key
 * - byok: Uses user's decrypted API key
 * - debug: Should not reach this proxy (routed to Anthropic directly)
 */
async function getApiKeyForSession(sessionId: string): Promise<string | null> {
  let uuid: string
  try {
    uuid = sessionIdToUuid(sessionId)
  } catch {
    log.warn({ sessionId }, "Invalid session ID format")
    return null
  }

  const session = await prisma.session.findUnique({
    where: { id: uuid },
    select: {
      providerMode: true,
      user: {
        select: { anthropicApiKeyEnc: true },
      },
    },
  })

  if (!session) {
    log.warn({ sessionId }, "Session not found for API key lookup")
    return null
  }

  if (session.providerMode === "byok") {
    if (!session.user?.anthropicApiKeyEnc) {
      log.error({ sessionId }, "BYOK session missing user API key")
      return null
    }
    try {
      return decrypt(session.user.anthropicApiKeyEnc)
    } catch (error) {
      log.error({ sessionId, error }, "Failed to decrypt user API key")
      return null
    }
  }

  // hosted mode: use server's API key
  return config.anthropicApiKey || null
}

async function proxyRequest(request: Request, path: string) {
  const startTime = Date.now()
  const auth = getAuth(request)

  if (auth.type === "unauthorized") {
    log.warn({ path, reason: auth.reason }, "Anthropic proxy: unauthorized request")
    return new Response(
      JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "Invalid or missing authentication" },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  const url = `${config.anthropicApiUrl}/${path}`

  // Build headers based on auth type
  const headers: HeadersInit = {
    "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
    "Content-Type": request.headers.get("content-type") || "application/json",
  }

  // Pass through beta headers if present
  const betaHeader = request.headers.get("anthropic-beta")
  if (betaHeader) {
    headers["anthropic-beta"] = betaHeader
  }

  // Get API key based on session's provider mode
  const apiKey = await getApiKeyForSession(auth.sessionId)
  if (!apiKey) {
    log.error({ sessionId: auth.sessionId }, "No API key available for session")
    return new Response(
      JSON.stringify({
        type: "error",
        error: { type: "api_error", message: "Server configuration error" },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
  headers["x-api-key"] = apiKey

  log.info({ sessionId: auth.sessionId, path, method: request.method }, "Anthropic proxy: forwarding request")

  const response = await fetch(url, {
    method: request.method,
    headers,
    body: request.method !== "GET" ? request.body : undefined,
    // @ts-expect-error - duplex is needed for streaming request body
    duplex: "half",
  })

  const duration = Date.now() - startTime

  // Log response info
  const logContext = {
    sessionId: auth.sessionId,
    path,
    method: request.method,
    status: response.status,
    durationMs: duration,
  }

  if (response.ok) {
    log.info(logContext, "Anthropic proxy: response received")
  } else {
    log.warn(logContext, "Anthropic proxy: error response")
  }

  // For streaming responses, pass through as-is
  const contentType = response.headers.get("content-type") || "application/json"

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      // Pass through rate limit headers for observability
      ...(response.headers.get("x-ratelimit-limit-requests") && {
        "x-ratelimit-limit-requests": response.headers.get("x-ratelimit-limit-requests")!,
      }),
      ...(response.headers.get("x-ratelimit-remaining-requests") && {
        "x-ratelimit-remaining-requests": response.headers.get("x-ratelimit-remaining-requests")!,
      }),
    },
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxyRequest(request, path.join("/"))
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxyRequest(request, path.join("/"))
}

export async function PATCH(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxyRequest(request, path.join("/"))
}
