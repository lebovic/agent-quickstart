import type { IncomingMessage } from "http"
import jwt from "jsonwebtoken"
import type { Session } from "@prisma/client"
import { config } from "@/config"
import { log } from "@/lib/logger"
import { SessionContext } from "@/lib/schemas/session"
import { uuidToSessionId } from "@/lib/id"

export type RepoScopes = {
  read: string[]
  write: string[]
}

export type SessionJwtPayload = {
  session_id: string
  repos: RepoScopes
  branches: string[]
  iat: number
  exp: number
}

function extractScopes(context: SessionContext): { repos: RepoScopes; branches: string[] } {
  const readRepos = context.sources
    .filter((s) => s.type === "git_repository")
    .map((s) => {
      const match = s.url.match(/github\.com\/([^/]+\/[^/.]+)/)
      return match ? match[1] : null
    })
    .filter((r): r is string => r !== null)

  const writeRepos = context.outcomes.filter((o) => o.type === "git_repository").map((o) => o.git_info.repo)

  const branches = context.outcomes.filter((o) => o.type === "git_repository").flatMap((o) => o.git_info.branches)

  return {
    repos: { read: readRepos, write: writeRepos },
    branches,
  }
}

export function generateSessionJwt(session: Session): string {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET not configured")
  }

  const contextResult = SessionContext.safeParse(session.sessionContext)
  if (!contextResult.success) {
    log.error({ sessionId: session.id }, "Invalid session context during JWT generation")
    throw new Error("Invalid session context")
  }

  const { repos, branches } = extractScopes(contextResult.data)

  return jwt.sign(
    {
      session_id: uuidToSessionId(session.id),
      repos,
      branches,
      iat: Math.floor(Date.now() / 1000),
    },
    config.jwtSecret,
    { expiresIn: "4h" }
  )
}

/**
 * Verifies a session JWT token.
 * Returns the payload if valid, null if invalid or expired.
 */
export function verifySessionJwt(token: string): SessionJwtPayload | null {
  if (!config.jwtSecret) {
    log.error("JWT_SECRET not configured")
    return null
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as SessionJwtPayload

    if (!payload.session_id) {
      log.warn("JWT missing session_id claim")
      return null
    }

    if (!payload.repos || !payload.branches) {
      log.warn("JWT missing repos or branches claims")
      return null
    }

    return payload
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      log.debug({ err: err.message }, "JWT expired")
    } else if (err instanceof jwt.JsonWebTokenError) {
      log.debug({ err: err.message }, "Invalid JWT")
    } else {
      log.warn({ err: err instanceof Error ? err.message : "unknown" }, "JWT verification failed")
    }
    return null
  }
}

/**
 * Extracts JWT from Authorization header or x-api-key header.
 * Supports: "Bearer <token>" or raw token in x-api-key.
 */
export function extractJwtFromRequest(request: Request): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  const apiKey = request.headers.get("x-api-key")
  if (apiKey) {
    return apiKey
  }

  return null
}

export type SessionAuthResult =
  | { type: "session_authorized"; payload: SessionJwtPayload }
  | { type: "session_unauthorized"; reason: string }

/**
 * Authenticates a request for a specific session.
 * Extracts JWT, verifies it, and ensures it matches the expected session ID.
 */
export function authenticateSessionRequest(request: Request, expectedSessionId: string): SessionAuthResult {
  const token = extractJwtFromRequest(request)
  if (!token) {
    return { type: "session_unauthorized", reason: "no_token" }
  }

  const payload = verifySessionJwt(token)
  if (!payload) {
    return { type: "session_unauthorized", reason: "invalid_token" }
  }

  if (payload.session_id !== expectedSessionId) {
    return { type: "session_unauthorized", reason: "session_mismatch" }
  }

  return { type: "session_authorized", payload }
}

/**
 * Extracts JWT from an HTTP IncomingMessage (used for WebSocket upgrades).
 * Supports: "Bearer <token>" in Authorization header.
 */
function extractJwtFromIncomingMessage(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  return null
}

/**
 * Authenticates a WebSocket upgrade request for a specific session.
 * Extracts JWT from Authorization header, verifies it, and ensures it matches the expected session ID.
 */
export function authenticateWebSocketRequest(req: IncomingMessage, expectedSessionId: string): SessionAuthResult {
  const token = extractJwtFromIncomingMessage(req)
  if (!token) {
    return { type: "session_unauthorized", reason: "no_token" }
  }

  const payload = verifySessionJwt(token)
  if (!payload) {
    return { type: "session_unauthorized", reason: "invalid_token" }
  }

  if (payload.session_id !== expectedSessionId) {
    return { type: "session_unauthorized", reason: "session_mismatch" }
  }

  return { type: "session_authorized", payload }
}
