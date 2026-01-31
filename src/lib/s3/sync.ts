import { prisma } from "@/lib/db"
import { config } from "@/config"
import { log } from "@/lib/logger"
import { listSessionObjects, extractFilename, guessMimeType } from "./operations"

/**
 * Sync S3 objects with the database File records for a session.
 * Upserts files that exist in S3, deletes files that no longer exist.
 */
export async function syncSessionFiles(sessionId: string): Promise<void> {
  if (!config.sessionFiles) {
    return
  }

  const s3Objects = await listSessionObjects(sessionId)
  const s3Keys = new Set(s3Objects.map((obj) => `${obj.bucket}:${obj.key}`))

  await prisma.$transaction(async (tx) => {
    // Upsert each S3 object - preserves IDs for existing files
    for (const obj of s3Objects) {
      await tx.file.upsert({
        where: {
          s3Bucket_s3Key: { s3Bucket: obj.bucket, s3Key: obj.key },
        },
        create: {
          s3Bucket: obj.bucket,
          s3Key: obj.key,
          filename: extractFilename(obj.key),
          mimeType: guessMimeType(extractFilename(obj.key)),
          sizeBytes: obj.size,
          originSessionId: sessionId,
          createdAt: obj.lastModified,
        },
        update: {
          sizeBytes: obj.size,
        },
      })
    }

    // Delete files no longer in S3
    const existingFiles = await tx.file.findMany({
      where: { originSessionId: sessionId },
      select: { id: true, s3Bucket: true, s3Key: true },
    })

    const toDelete = existingFiles.filter((f) => !s3Keys.has(`${f.s3Bucket}:${f.s3Key}`))

    if (toDelete.length > 0) {
      await tx.file.deleteMany({
        where: { id: { in: toDelete.map((f) => f.id) } },
      })
    }

    // Update storage used
    const totalBytes = s3Objects.reduce((sum, obj) => sum + obj.size, BigInt(0))
    await tx.session.update({
      where: { id: sessionId },
      data: { storageUsedBytes: totalBytes },
    })
  })

  log.debug({ sessionId, fileCount: s3Objects.length }, "Synced session files with S3")
}
