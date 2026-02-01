import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sessionIdToUuid, fileIdToUuid } from "@/lib/id"
import { badRequest, notFound, forbidden, unauthorized } from "@/lib/http-errors"
import { getUserProviderContext } from "@/lib/auth/provider-context"
import { deleteFile } from "@/lib/s3/operations"
import { config } from "@/config"

type RouteParams = { params: Promise<{ id: string; fileId: string }> }

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
      deletedAt: null,
    },
  })

  if (!file) {
    return notFound("File not found")
  }

  // Delete from S3 (hard delete)
  await deleteFile(file.s3Bucket, file.s3Key)

  // Soft delete in DB and decrement storage used
  await prisma.$transaction([
    prisma.file.update({
      where: { id: fileUuid },
      data: { deletedAt: new Date() },
    }),
    prisma.session.update({
      where: { id: sessionUuid },
      data: { storageUsedBytes: { decrement: file.sizeBytes } },
    }),
  ])

  return new NextResponse(null, { status: 204 })
}
