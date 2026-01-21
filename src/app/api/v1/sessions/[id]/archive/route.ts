import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sessionIdToUuid } from "@/lib/id"
import { badRequest, notFound, conflict, forbidden, unauthorized } from "@/lib/http-errors"
import { toApiSession } from "@/lib/schemas/session"
import { proxyToAnthropic } from "@/lib/api/proxy"
import { stopSession } from "@/lib/executor"
import { getUserProviderContext } from "@/lib/auth/provider-context"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/sessions/${id}/archive`, {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  const userId = userContext.userId

  let uuid: string
  try {
    uuid = sessionIdToUuid(id)
  } catch {
    return badRequest("Invalid session ID")
  }

  const existing = await prisma.session.findUnique({
    where: { id: uuid },
    include: { environment: true },
  })

  if (!existing) {
    return notFound("Session not found")
  }

  if (existing.userId !== userId) {
    return forbidden("Access denied")
  }

  if (existing.status === "archived") {
    return conflict("Session is already archived")
  }

  // Stop container if running
  await stopSession(existing)

  const session = await prisma.session.update({
    where: { id: uuid },
    data: { status: "archived" },
  })

  return NextResponse.json(toApiSession(session))
}
