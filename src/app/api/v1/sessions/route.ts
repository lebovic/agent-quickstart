import { type NextRequest, NextResponse } from "next/server"
import { type Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { generateUuid, envIdToUuid, sessionIdToUuid } from "@/lib/id"
import { badRequest, notFound, unauthorized } from "@/lib/http-errors"
import { parsePaginationParams, paginatedResponse } from "@/lib/pagination"
import { CreateSessionRequest, toApiSession } from "@/lib/schemas/session"
import { extractEvent } from "@/lib/schemas/event"
import { spawnSession } from "@/lib/executor"
import { log } from "@/lib/logger"
import { proxyToAnthropic } from "@/lib/api/proxy"
import { getUserProviderContext } from "@/lib/auth/provider-context"
import { generateSessionTitle } from "@/lib/ai/generate-title"

export async function GET(request: NextRequest) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, "v1/sessions", {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  const userId = userContext.userId
  const { searchParams } = new URL(request.url)
  const pagination = parsePaginationParams(searchParams, sessionIdToUuid)

  const sessions = await prisma.session.findMany({
    where: { userId, status: { not: "deleted" } },
    take: pagination.take,
    skip: pagination.skip,
    cursor: pagination.cursor,
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(paginatedResponse(sessions.map(toApiSession), pagination.limit, (s) => s.id))
}

export async function POST(request: NextRequest) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, "v1/sessions", {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  const userId = userContext.userId
  const providerMode = userContext.provider.mode
  const body = await request.json()
  const parsed = CreateSessionRequest.safeParse(body)

  if (!parsed.success) {
    return badRequest("Invalid request body")
  }

  const { data } = parsed
  let environmentId: string

  try {
    environmentId = envIdToUuid(data.environment_id)
  } catch {
    return badRequest("Invalid environment ID")
  }

  const environment = await prisma.environment.findUnique({
    where: { id: environmentId },
  })

  if (!environment) {
    return notFound("Environment not found")
  }

  const sessionId = generateUuid()
  const hasEvents = data.events && data.events.length > 0

  // Extract events once upfront to avoid duplicate parsing
  const extractedEvents = hasEvents ? data.events!.map(extractEvent) : []

  // Generate title from first user message
  const firstEvent = extractedEvents[0]
  let title = data.title
  if (firstEvent?.type === "user" && firstEvent.message) {
    const { content } = firstEvent.message
    const promptText = Array.isArray(content) ? content.find((b): b is { type: "text"; text: string } => b.type === "text")?.text : content
    if (promptText) {
      title = await generateSessionTitle(promptText)
    }
  }

  // Create session - status is "running" when events provided (matches API behavior)
  const session = await prisma.session.create({
    data: {
      id: sessionId,
      title,
      environmentId,
      userId,
      status: hasEvents ? "running" : "idle",
      providerMode,
      sessionContext: data.session_context,
    },
    include: { environment: true },
  })

  // If events are provided, insert them and spawn container
  if (hasEvents) {
    // Build records from pre-extracted events
    const eventRecords = extractedEvents.map((event, index) => {
      // Type assertion justified: event came from request.json(), guaranteed valid JSON
      const eventJson = event as unknown as Prisma.InputJsonValue
      return {
        id: event.uuid,
        sessionId,
        type: event.type,
        subtype: event.subtype,
        data: eventJson,
        parentToolUseId: event.parent_tool_use_id,
        sequenceNum: index + 1,
      }
    })

    await prisma.event.createMany({
      data: eventRecords,
    })

    // Track last event UUID for optimistic concurrency (used by PUT session_ingress)
    const lastEventUuid = eventRecords[eventRecords.length - 1].id
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastEventUuid },
    })

    log.info({ sessionId, eventCount: eventRecords.length, lastEventUuid }, "Inserted initial events")

    // Spawn container async - errors update status to "failed" via error handler
    spawnSession(session).catch((err) => {
      log.error({ sessionId, err }, "Failed to spawn container")
    })
  }

  return NextResponse.json(toApiSession(session), { status: 201 })
}
