import { type NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { sessionIdToUuid } from "@/lib/id"
import { badRequest, notFound, internalError, unauthorized } from "@/lib/http-errors"
import { log } from "@/lib/logger"
import { authenticateSessionRequest } from "@/lib/auth/jwt"
import { BaseEvent } from "@/lib/schemas/event"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  // Authenticate request - JWT must be valid and match session ID
  const auth = authenticateSessionRequest(request, id)
  if (auth.type !== "session_authorized") {
    log.debug({ sessionId: id, reason: auth.reason }, "Session ingress GET unauthorized")
    return unauthorized("Authentication required")
  }

  let sessionUuid: string

  try {
    sessionUuid = sessionIdToUuid(id)
  } catch {
    return badRequest("Invalid session ID")
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionUuid },
  })

  if (!session) {
    return notFound("Session not found")
  }

  // Only return events that have been sent to Claude (not pending)
  const events = await prisma.event.findMany({
    where: { sessionId: sessionUuid, status: "sent" },
    orderBy: { sequenceNum: "asc" },
  })

  const loglines = events.map((event) => event.data)

  return NextResponse.json({ loglines })
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  // Authenticate request - JWT must be valid and match session ID
  const auth = authenticateSessionRequest(request, id)
  if (auth.type !== "session_authorized") {
    log.debug({ sessionId: id, reason: auth.reason }, "Session ingress PUT unauthorized")
    return unauthorized("Authentication required")
  }

  let sessionUuid: string

  try {
    sessionUuid = sessionIdToUuid(id)
  } catch {
    return badRequest("Invalid session ID")
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionUuid },
  })

  if (!session) {
    return notFound("Session not found")
  }

  const body = await request.json()

  if (body.isReplay) {
    return NextResponse.json({ message: "Log appended successfully", success: true })
  }

  // Validate the event body
  const parsed = BaseEvent.safeParse(body)
  if (!parsed.success) {
    return badRequest("Invalid event body")
  }

  const event = parsed.data
  // Type assertion justified: body came from request.json(), guaranteed valid JSON
  const eventJson = event as unknown as Prisma.InputJsonValue

  // Check idempotency first - if event already exists, return success
  const existing = await prisma.event.findUnique({
    where: { id: event.uuid },
  })

  if (existing) {
    return NextResponse.json({ message: "Log appended successfully", success: true })
  }

  // Validate Last-Uuid exists in session (doesn't need to be immediately previous)
  const lastUuid = request.headers.get("Last-Uuid")
  if (lastUuid) {
    try {
      const lastUuidEvent = await prisma.event.findFirst({
        where: { sessionId: sessionUuid, id: lastUuid },
      })
      if (!lastUuidEvent) {
        log.debug({ sessionId: sessionUuid, lastUuid }, "Last-Uuid mismatch")
        return internalError()
      }
    } catch {
      // Invalid UUID format
      log.debug({ sessionId: sessionUuid, lastUuid }, "Last-Uuid mismatch")
      return internalError()
    }
  }

  const lastEvent = await prisma.event.findFirst({
    where: { sessionId: sessionUuid },
    orderBy: { sequenceNum: "desc" },
  })

  const nextSequenceNum = lastEvent ? lastEvent.sequenceNum + 1 : 0

  // Only create the event - lastEventUuid is updated via WebSocket path
  // This allows concurrent PUTs with the same Last-Uuid to succeed
  await prisma.event.create({
    data: {
      id: event.uuid,
      sessionId: sessionUuid,
      type: event.type,
      subtype: event.subtype,
      status: "sent",
      parentToolUseId: event.parent_tool_use_id,
      sequenceNum: nextSequenceNum,
      data: eventJson,
    },
  })

  return NextResponse.json({ message: "Log appended successfully", success: true })
}
