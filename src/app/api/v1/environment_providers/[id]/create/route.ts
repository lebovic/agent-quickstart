import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { generateUuid } from "@/lib/id"
import { badRequest, unauthorized } from "@/lib/http-errors"
import { CreateEnvironmentRequest, EnvironmentKind, toApiEnvironment, encryptConfig } from "@/lib/schemas/environment"
import { proxyToAnthropic } from "@/lib/api/proxy"
import { getUserProviderContext } from "@/lib/auth/provider-context"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { id: kind } = await params

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, `v1/environment_providers/private/organizations/${userContext.provider.orgUuid}/cloud/create`, {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  const kindParsed = EnvironmentKind.safeParse(kind)
  if (!kindParsed.success) {
    return badRequest("Invalid environment kind")
  }

  const body = await request.json()
  const parsed = CreateEnvironmentRequest.safeParse(body)

  if (!parsed.success) {
    return badRequest("Invalid request body")
  }

  const environmentId = generateUuid()

  const encryptedConfig = encryptConfig(parsed.data.config)

  const environment = await prisma.environment.create({
    data: {
      id: environmentId,
      name: parsed.data.name,
      kind: kindParsed.data,
      state: "active",
      userId: userContext.userId,
      ...(encryptedConfig && { configEnc: encryptedConfig }),
    },
  })

  return NextResponse.json(toApiEnvironment(environment, true), { status: 201 })
}
