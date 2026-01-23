import type { IncomingMessage } from "http"
import { type WebSocket } from "ws"
import { prisma } from "../../src/lib/db"
import { log } from "../../src/lib/logger"
import { IngressMessage } from "../../src/lib/schemas/event"
import { uuidToSessionId } from "../../src/lib/id"
import { getSessionManager } from "./session-manager"
import { authenticateWebSocketRequest } from "../../src/lib/auth/jwt"

export async function handleIngressConnection(sessionId: string, ws: WebSocket, req: IncomingMessage): Promise<void> {
  // Validate JWT from Authorization header
  const taggedSessionId = uuidToSessionId(sessionId)
  const auth = authenticateWebSocketRequest(req, taggedSessionId)
  if (auth.type !== "session_authorized") {
    log.warn({ sessionId, reason: auth.reason }, "Ingress WebSocket unauthorized")
    ws.close(4001, "Authentication required")
    return
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  })

  if (!session) {
    log.warn({ sessionId }, "Ingress tried to connect to non-existent session")
    ws.close(4004, "Session not found")
    return
  }

  const manager = await getSessionManager()
  const error = manager.setIngress(sessionId, ws)

  if (error) {
    log.warn({ sessionId, error }, "Ingress connection rejected")
    ws.close(4003, error)
    return
  }

  log.info({ sessionId }, "Ingress connected to session")

  // Update status on connect (updatedAt is auto-updated)
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "running" },
  })

  // Send initialization message - this may be required to trigger Claude to start processing
  const initMessage = {
    request_id: crypto.randomUUID(),
    type: "control_request",
    request: { subtype: "initialize" },
  }
  log.debug({ sessionId, message: initMessage }, "Sending init message to container")
  ws.send(JSON.stringify(initMessage) + "\n")

  // Notify waiting browser subscribers that the session is now ready.
  // Works around an edge case where Claude Code doesn't respond to initialize
  // requests when resuming a session, despite receiving them. TODO: fix
  manager.broadcastToSubscribers(sessionId, {
    type: "control_response",
    request_id: "ingress_connected",
    response: { subtype: "error", error: "Already initialized" },
  })

  // Send pending events after init to trigger processing
  // Ideally, this would send after the sandbox is connected and ready to receive messsages
  // In practice, this sets an upper-bound on sandbox startup time to the setTimeout delay
  // TODO: properly queue and send messages to session on connect
  setTimeout(async () => {
    const pendingEvents = await prisma.event.findMany({
      where: { sessionId, status: "pending" },
      orderBy: { sequenceNum: "asc" },
    })

    for (const event of pendingEvents) {
      const data = event.data as Record<string, unknown>
      const msg = {
        type: event.type,
        uuid: data.uuid ?? event.id,
        session_id: taggedSessionId,
        message: data.message,
      }
      log.debug({ sessionId, message: msg }, "Sending pending event")
      ws.send(JSON.stringify(msg) + "\n")

      // Mark as sent
      await prisma.event.update({
        where: { id: event.id },
        data: { status: "sent" },
      })
    }
  }, 3000)

  ws.on("message", async (data) => {
    const message = data.toString()

    // Update activity timestamp on each message
    await prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    })

    try {
      const raw = JSON.parse(message)
      log.debug({ sessionId, message: raw }, "Ingress received message")
      const parsed = IngressMessage.safeParse(raw)

      if (!parsed.success) {
        log.warn({ sessionId, error: parsed.error.message }, "Failed to parse ingress message")
        return
      }

      const msg = parsed.data

      // Store and notify control_response via Postgres for multi-node support
      if (msg.type === "control_response") {
        log.debug({ sessionId, response: msg.response }, "Received control_response")
        const eventId = crypto.randomUUID()
        const lastEvent = await prisma.event.findFirst({
          where: { sessionId },
          orderBy: { sequenceNum: "desc" },
        })
        await prisma.event.create({
          data: {
            id: eventId,
            sessionId,
            type: msg.type,
            subtype: msg.response.subtype,
            status: "sent",
            sequenceNum: lastEvent ? lastEvent.sequenceNum + 1 : 0,
            data: { ...raw, uuid: eventId },
          },
        })
        await manager.notify(sessionId, eventId)
        return
      }

      // Handle control requests based on subtype
      if (msg.type === "control_request") {
        const subtype = msg.request.subtype
        log.debug({ sessionId, subtype, request: msg.request }, "Received control_request")

        // Permission requests (can_use_tool) need behavior + updatedInput
        if (subtype === "can_use_tool") {
          log.debug({ sessionId, toolName: msg.request.tool_name, input: msg.request.input }, "can_use_tool request")
          ws.send(
            JSON.stringify({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: msg.request_id,
                response: {
                  behavior: "allow",
                  updatedInput: msg.request.input ?? {},
                },
              },
            }) + "\n"
          )
          return
        }

        // Other control requests just need a success acknowledgment
        ws.send(
          JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: msg.request_id,
            },
          }) + "\n"
        )
        return
      }

      // Regular events (user, assistant, system, result, etc.) - store and notify
      // No ack needed - container doesn't expect control_response for regular events
      if (raw.isReplay) {
        log.debug({ sessionId, uuid: msg.uuid }, "Skipping replayed event")
      } else {
        const existing = await prisma.event.findUnique({
          where: { id: msg.uuid },
        })

        if (!existing) {
          const lastEvent = await prisma.event.findFirst({
            where: { sessionId },
            orderBy: { sequenceNum: "desc" },
          })

          await prisma.event.create({
            data: {
              id: msg.uuid,
              sessionId,
              type: msg.type,
              subtype: msg.subtype,
              status: "sent",
              parentToolUseId: msg.parent_tool_use_id,
              sequenceNum: lastEvent ? lastEvent.sequenceNum + 1 : 0,
              data: raw,
            },
          })
        }

        await manager.notify(sessionId, msg.uuid)
      }
    } catch (err) {
      log.error({ sessionId, err: (err as Error).message }, "Failed to process ingress message")
    }
  })

  ws.on("close", async (code, reason) => {
    manager.removeIngress(sessionId)
    log.info({ sessionId, code, reason: reason?.toString() }, "Ingress disconnected from session")

    // Set session to idle so it can be restarted
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "idle" },
    })
  })

  ws.on("error", (err) => {
    log.error({ sessionId, err: err.message }, "Ingress WebSocket error")
    manager.removeIngress(sessionId)
  })
}
