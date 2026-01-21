import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { envIdToUuid } from "@/lib/id"
import { badRequest, notFound, unauthorized } from "@/lib/http-errors"
import { UpdateEnvironmentRequest, toApiEnvironment, encryptConfig } from "@/lib/schemas/environment"
import { proxyToAnthropic } from "@/lib/api/proxy"
import { getUserProviderContext } from "@/lib/auth/provider-context"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/environment_providers/${id}`, {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  let uuid: string
  try {
    uuid = envIdToUuid(id)
  } catch {
    return badRequest("Invalid environment ID")
  }

  const environment = await prisma.environment.findUnique({
    where: { id: uuid },
  })

  if (!environment) {
    return notFound("Environment not found")
  }

  // Verify ownership
  if (environment.userId !== userContext.userId) {
    return notFound("Environment not found")
  }

  return NextResponse.json(toApiEnvironment(environment, true))
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/environment_providers/private/organizations/${userContext.provider.orgUuid}/environments/${id}`, {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  let uuid: string
  try {
    uuid = envIdToUuid(id)
  } catch {
    return badRequest("Invalid environment ID")
  }

  const body = await request.json()
  const parsed = UpdateEnvironmentRequest.safeParse(body)

  if (!parsed.success) {
    return badRequest("Invalid request body")
  }

  const existing = await prisma.environment.findUnique({
    where: { id: uuid },
  })

  if (!existing) {
    return notFound("Environment not found")
  }

  // Verify ownership
  if (existing.userId !== userContext.userId) {
    return notFound("Environment not found")
  }

  const updateData: { name?: string; configEnc?: string } = {}
  if (parsed.data.name !== undefined) {
    updateData.name = parsed.data.name
  }
  if (parsed.data.config !== undefined) {
    const encrypted = encryptConfig(parsed.data.config)
    if (encrypted) {
      updateData.configEnc = encrypted
    }
  }

  const environment = await prisma.environment.update({
    where: { id: uuid },
    data: updateData,
  })

  return NextResponse.json(toApiEnvironment(environment, true))
}
