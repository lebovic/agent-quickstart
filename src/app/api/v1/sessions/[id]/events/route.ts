import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sessionIdToUuid } from "@/lib/id"
import { badRequest, notFound, forbidden, unauthorized } from "@/lib/http-errors"
import { parsePaginationParams, paginatedResponse } from "@/lib/pagination"
import { parseEventData } from "@/lib/schemas/event"
import { proxyToAnthropic } from "@/lib/api/proxy"
import { getUserProviderContext } from "@/lib/auth/provider-context"

type RouteParams = { params: Promise<{ id: string }> }

function eventIdToUuid(id: string): string {
  return id
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/sessions/${id}/events`, {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  const userId = userContext.userId

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

  if (session.userId !== userId) {
    return forbidden("Access denied")
  }

  const { searchParams } = new URL(request.url)
  const pagination = parsePaginationParams(searchParams, eventIdToUuid)

  // Return all events for UI display (both pending and sent)
  // The --resume endpoint (session_ingress) still filters by sent only
  const events = await prisma.event.findMany({
    where: { sessionId: sessionUuid },
    take: pagination.take,
    skip: pagination.skip,
    cursor: pagination.cursor,
    orderBy: { sequenceNum: "asc" },
  })

  const data = events.map((event) => parseEventData(event.data))

  return NextResponse.json(paginatedResponse(data, pagination.limit, (e) => e.uuid))
}
