import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { envIdToUuid } from "@/lib/id"
import { parsePaginationParams } from "@/lib/pagination"
import { toApiEnvironment } from "@/lib/schemas/environment"
import { proxyToAnthropic } from "@/lib/api/proxy"
import { getUserProviderContext } from "@/lib/auth/provider-context"
import { badRequest, unauthorized } from "@/lib/http-errors"

export async function GET(request: NextRequest) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)

  if (userContext.provider.mode === "debug") {
    return proxyToAnthropic(request, "v1/environment_providers", {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  const { searchParams } = new URL(request.url)
  const pagination = parsePaginationParams(searchParams, envIdToUuid)

  const environments = await prisma.environment.findMany({
    where: { userId: userContext.userId },
    take: pagination.take,
    skip: pagination.skip,
    cursor: pagination.cursor,
    orderBy: { createdAt: "desc" },
  })

  const hasMore = environments.length > pagination.limit
  const data = hasMore ? environments.slice(0, pagination.limit) : environments
  const apiEnvironments = data.map((env) => toApiEnvironment(env, false))

  return NextResponse.json({
    environments: apiEnvironments,
    has_more: hasMore,
    ...(apiEnvironments.length > 0 && {
      first_id: apiEnvironments[0].environment_id,
      last_id: apiEnvironments[apiEnvironments.length - 1].environment_id,
    }),
  })
}
