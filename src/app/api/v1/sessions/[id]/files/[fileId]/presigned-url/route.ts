import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sessionIdToUuid, fileIdToUuid } from "@/lib/id"
import { badRequest, notFound, forbidden, unauthorized } from "@/lib/http-errors"
import { getUserProviderContext } from "@/lib/auth/provider-context"
import { getPresignedDownloadUrl } from "@/lib/s3/operations"
import { config } from "@/config"
import type { PresignedUrlResponse } from "@/lib/schemas/file"

type RouteParams = { params: Promise<{ id: string; fileId: string }> }

const PRESIGNED_URL_EXPIRES_SECONDS = 900 // 15 minutes

export async function GET(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)

  if (!config.sessionFiles) {
    return badRequest("Session files not enabled")
  }

  const { id, fileId } = await params

  let sessionUuid: string
  try {
    sessionUuid = sessionIdToUuid(id)
  } catch {
    return badRequest("Invalid session ID")
  }

  let fileUuid: string
  try {
    fileUuid = fileIdToUuid(fileId)
  } catch {
    return badRequest("Invalid file ID")
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionUuid },
  })

  if (!session) {
    return notFound("Session not found")
  }

  if (session.userId !== userContext.userId) {
    return forbidden("Access denied")
  }

  const file = await prisma.file.findFirst({
    where: {
      id: fileUuid,
      originSessionId: sessionUuid,
    },
  })

  if (!file) {
    return notFound("File not found")
  }

  const url = await getPresignedDownloadUrl(file.s3Bucket, file.s3Key, PRESIGNED_URL_EXPIRES_SECONDS)

  const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRES_SECONDS * 1000)

  const response: PresignedUrlResponse = {
    type: "file_download_url",
    url,
    expires_at: expiresAt.toISOString(),
  }

  return NextResponse.json(response)
}
