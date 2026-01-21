import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { uuidToSessionId, sessionIdToUuid } from "@/lib/id"
import { badRequest, notFound, forbidden, unauthorized } from "@/lib/http-errors"
import { UpdateSessionRequest, toApiSession } from "@/lib/schemas/session"
import { proxyToAnthropic } from "@/lib/api/proxy"
import { removeSession } from "@/lib/executor"
import { getUserProviderContext } from "@/lib/auth/provider-context"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/sessions/${id}`, {
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

  const session = await prisma.session.findUnique({
    where: { id: uuid },
  })

  if (!session) {
    return notFound("Session not found")
  }

  if (session.userId !== userId) {
    return forbidden("Access denied")
  }

  return NextResponse.json(toApiSession(session))
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/sessions/${id}`, {
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

  const body = await request.json()
  const parsed = UpdateSessionRequest.safeParse(body)

  if (!parsed.success) {
    return badRequest("Invalid request body")
  }

  const existing = await prisma.session.findUnique({
    where: { id: uuid },
  })

  if (!existing) {
    return notFound("Session not found")
  }

  if (existing.userId !== userId) {
    return forbidden("Access denied")
  }

  const session = await prisma.session.update({
    where: { id: uuid },
    data: { title: parsed.data.title },
  })

  return NextResponse.json(toApiSession(session))
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/sessions/${id}`, {
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

  const session = await prisma.session.findUnique({
    where: { id: uuid },
    include: { environment: true },
  })

  if (!session) {
    return notFound("Session not found")
  }

  if (session.userId !== userId) {
    return forbidden("Access denied")
  }

  // Remove container (force stops if running)
  await removeSession(session)

  // Soft delete - set status to deleted
  await prisma.session.update({
    where: { id: uuid },
    data: { status: "deleted", containerId: null },
  })

  return NextResponse.json({
    id: uuidToSessionId(uuid),
    type: "session_deleted",
  })
}
