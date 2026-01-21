import type { IncomingMessage } from "http"
import { type WebSocket, type RawData } from "ws"
import { prisma } from "../../src/lib/db"
import { log } from "../../src/lib/logger"
import { decrypt } from "../../src/lib/crypto/encryption"
import { getSessionManager } from "./session-manager"
import { spawnSession } from "../../src/lib/executor"
import { proxyToAnthropicWebSocket } from "./anthropic-proxy"
import { auth } from "../../src/lib/auth/auth"

/**
 * Authenticates a WebSocket request using session cookies.
 * Returns the user if authenticated, null otherwise.
 */
async function authenticateFromCookies(req: IncomingMessage) {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return null

  // Parse cookies into Headers format for better-auth
  const headers = new Headers()
  headers.set("cookie", cookieHeader)

  try {
    const session = await auth.api.getSession({ headers })
    return session?.user ?? null
  } catch {
    return null
  }
}

export async function handleClientConnection(
  taggedSessionId: string,
  sessionUuid: string | null,
  ws: WebSocket,
  req: IncomingMessage
): Promise<void> {
  // Buffer messages during async setup to prevent race conditions.
  // Messages that arrive before handlers are fully set up would otherwise be lost.
  const messageBuffer: RawData[] = []
  let setupComplete = false
  let messageHandler: ((data: RawData) => void) | null = null

  const bufferingHandler = (data: RawData) => {
    if (setupComplete && messageHandler) {
      messageHandler(data)
    } else {
      messageBuffer.push(data)
    }
  }

  ws.on("message", bufferingHandler)

  // Helper to clean up buffering handler and close connection
  const closeWithError = (code: number, message: string) => {
    ws.off("message", bufferingHandler)
    ws.close(code, message)
  }

  // Helper to hand off to Anthropic proxy with buffered messages
  const handoffToProxy = (sessionKey: string, orgUuid: string) => {
    ws.off("message", bufferingHandler)
    return proxyToAnthropicWebSocket(taggedSessionId, ws, sessionKey, orgUuid, messageBuffer)
  }

  // If we couldn't parse the session ID as a UUID, it might be an external session (debug mode)
  if (!sessionUuid) {
    const user = await authenticateFromCookies(req)
    if (!user) {
      log.warn({ taggedSessionId }, "Client tried to connect without authentication")
      return closeWithError(4001, "Authentication required")
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        provider: true,
        anthropicSessionKeyEnc: true,
        anthropicOrgUuid: true,
      },
    })

    if (dbUser?.provider === "debug") {
      if (!dbUser.anthropicSessionKeyEnc || !dbUser.anthropicOrgUuid) {
        log.error({ taggedSessionId, userId: user.id }, "Debug user missing credentials")
        return closeWithError(4003, "Debug credentials not configured")
      }

      let sessionKey: string
      try {
        sessionKey = decrypt(dbUser.anthropicSessionKeyEnc)
      } catch (err) {
        log.error({ taggedSessionId, err }, "Failed to decrypt session key")
        return closeWithError(4003, "Failed to decrypt credentials")
      }

      return handoffToProxy(sessionKey, dbUser.anthropicOrgUuid)
    }

    log.warn({ taggedSessionId }, "Invalid session ID format and not in debug mode")
    return closeWithError(4004, "Invalid session ID")
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionUuid },
    include: { environment: true, user: true },
  })

  // Session not found locally - check if user is in debug mode
  if (!session) {
    const user = await authenticateFromCookies(req)
    if (!user) {
      log.warn({ taggedSessionId, sessionUuid }, "Client tried to connect without authentication")
      return closeWithError(4001, "Authentication required")
    }

    // Check user's provider mode
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        provider: true,
        anthropicSessionKeyEnc: true,
        anthropicOrgUuid: true,
      },
    })

    if (dbUser?.provider === "debug") {
      // Debug mode: proxy to Anthropic using the original session ID
      if (!dbUser.anthropicSessionKeyEnc || !dbUser.anthropicOrgUuid) {
        log.error({ taggedSessionId, userId: user.id }, "Debug user missing credentials")
        return closeWithError(4003, "Debug credentials not configured")
      }

      let sessionKey: string
      try {
        sessionKey = decrypt(dbUser.anthropicSessionKeyEnc)
      } catch (err) {
        log.error({ taggedSessionId, err }, "Failed to decrypt session key")
        return closeWithError(4003, "Failed to decrypt credentials")
      }

      return handoffToProxy(sessionKey, dbUser.anthropicOrgUuid)
    }

    log.warn({ taggedSessionId, sessionUuid }, "Client tried to connect to non-existent session")
    return closeWithError(4004, "Session not found")
  }

  // Session exists locally - check provider mode
  if (session.providerMode === "debug") {
    if (!session.user?.anthropicSessionKeyEnc || !session.user?.anthropicOrgUuid) {
      log.error({ taggedSessionId, sessionUuid }, "Debug session missing user credentials")
      return closeWithError(4003, "Debug credentials not configured")
    }

    let sessionKey: string
    try {
      sessionKey = decrypt(session.user.anthropicSessionKeyEnc)
    } catch (err) {
      log.error({ taggedSessionId, err }, "Failed to decrypt session key")
      return closeWithError(4003, "Failed to decrypt credentials")
    }

    return handoffToProxy(sessionKey, session.user.anthropicOrgUuid)
  }

  // Hosted/BYOK mode: use local infrastructure
  const manager = await getSessionManager()
  const subscribeError = await manager.addSubscriber(sessionUuid, ws)

  if (subscribeError) {
    log.warn({ sessionUuid, error: subscribeError }, "Client subscription rejected")
    return closeWithError(4003, subscribeError)
  }

  log.info({ sessionUuid }, "Client subscribed to session")

  // Spawn container if needed
  const isIdle = session.status === "idle"
  const isStale = session.status === "running" && !manager.hasIngress(sessionUuid)

  if (isIdle || isStale) {
    log.info({ sessionUuid, isIdle, isStale }, "Spawning container on client connect")
    spawnSession(session).catch((err) => {
      log.error({ sessionUuid, err }, "Failed to spawn container on client connect")
    })
  }

  // Define the message handler for hosted mode
  messageHandler = async (data: RawData) => {
    const message = data.toString()

    // Update activity timestamp on each message from browser
    await prisma.session.update({
      where: { id: sessionUuid },
      data: { updatedAt: new Date() },
    })

    // Echo user messages back to confirm receipt
    try {
      const parsed = JSON.parse(message)
      log.debug({ sessionUuid, message: parsed }, "Client message received")
      if (parsed.type === "user") {
        log.debug({ sessionUuid, uuid: parsed.uuid }, "Echoing user message back to subscribers")
        manager.broadcastToSubscribers(sessionUuid, parsed)
      }

      // Handle initialize requests: respond directly if ingress is connected
      // (The server already initializes the container when ingress connects)
      if (parsed.type === "control_request" && parsed.request?.subtype === "initialize") {
        if (manager.hasIngress(sessionUuid)) {
          log.debug({ sessionUuid }, "Responding to initialize request on behalf of connected ingress")
          ws.send(
            JSON.stringify({
              type: "control_response",
              request_id: parsed.request_id,
              response: { subtype: "success" },
            })
          )
          return
        }
        // If no ingress, fall through to forward the message (it will be queued or fail)
      }
    } catch (err) {
      log.warn({ sessionUuid, err }, "Failed to parse client message as JSON")
    }

    const sendError = manager.sendToIngress(sessionUuid, message)
    if (sendError) {
      log.debug({ sessionUuid, error: sendError }, "Failed to forward message to ingress")
    } else {
      log.debug({ sessionUuid }, "Message forwarded to ingress")
    }
  }

  // Mark setup complete and process any messages that arrived during setup
  setupComplete = true
  for (const data of messageBuffer) {
    messageHandler(data)
  }

  ws.on("close", async () => {
    await manager.removeSubscriber(sessionUuid, ws)
    log.info({ sessionUuid }, "Client unsubscribed from session")
  })

  ws.on("error", (err) => {
    log.error({ sessionUuid, err: err.message }, "Client WebSocket error")
  })
}
