import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sessionIdToUuid, uuidToFileId } from "@/lib/id"
import { badRequest, notFound, forbidden, unauthorized } from "@/lib/http-errors"
import { getUserProviderContext } from "@/lib/auth/provider-context"
import { syncSessionFiles } from "@/lib/s3/sync"
import { uploadSessionFile, guessMimeType } from "@/lib/s3/operations"
import { toApiFile, type ListFilesResponse } from "@/lib/schemas/file"
import { config } from "@/config"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)

  if (!config.sessionFiles) {
    return badRequest("Session files not enabled")
  }

  const { id } = await params

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

  if (session.userId !== userContext.userId) {
    return forbidden("Access denied")
  }

  await syncSessionFiles(sessionUuid)

  const files = await prisma.file.findMany({
    where: { originSessionId: sessionUuid },
    orderBy: { createdAt: "desc" },
  })

  const response: ListFilesResponse = {
    data: files.map(toApiFile),
    first_id: files.length > 0 ? uuidToFileId(files[0].id) : null,
    last_id: files.length > 0 ? uuidToFileId(files[files.length - 1].id) : null,
    has_more: false,
  }

  return NextResponse.json(response)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)

  if (!config.sessionFiles) {
    return badRequest("Session files not enabled")
  }

  const { id } = await params

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

  if (session.userId !== userContext.userId) {
    return forbidden("Access denied")
  }

  const formData = await request.formData()
  const file = formData.get("file")

  if (!file || !(file instanceof File)) {
    return badRequest("No file provided")
  }

  if (file.size > config.sessionFiles.maxFileSizeBytes) {
    return badRequest("File too large")
  }

  const currentUsed = Number(session.storageUsedBytes)
  const quota = Number(session.storageQuotaBytes)
  if (currentUsed + file.size > quota) {
    return badRequest("Storage quota exceeded")
  }

  const mimeType = file.type || guessMimeType(file.name)
  const stream = file.stream()

  const { bucket, key } = await uploadSessionFile(sessionUuid, file.name, stream, file.size, mimeType)

  const dbFile = await prisma.file.create({
    data: {
      s3Bucket: bucket,
      s3Key: key,
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
      originSessionId: sessionUuid,
    },
  })

  await prisma.session.update({
    where: { id: sessionUuid },
    data: { storageUsedBytes: { increment: file.size } },
  })

  return NextResponse.json(toApiFile(dbFile), { status: 201 })
}
