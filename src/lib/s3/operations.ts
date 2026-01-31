import { ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getS3Client } from "./client"
import { config } from "@/config"
import { log } from "@/lib/logger"

export interface S3Object {
  bucket: string
  key: string
  size: bigint
  lastModified: Date
}

/**
 * Build the S3 key for a session file.
 * Format: sessions/{sessionId}/{filename}
 */
export function buildSessionS3Key(sessionId: string, filename: string): string {
  return `sessions/${sessionId}/${filename}`
}

/**
 * Extract filename from an S3 key.
 */
export function extractFilename(s3Key: string): string {
  const parts = s3Key.split("/")
  return parts[parts.length - 1]
}

/**
 * List all objects in a session's S3 prefix.
 * TODO: Add pagination support for sessions with many files
 */
export async function listSessionObjects(sessionId: string): Promise<S3Object[]> {
  if (!config.sessionFiles) {
    throw new Error("Session files not configured")
  }

  const s3 = getS3Client()
  const bucket = config.sessionFiles.bucket
  const prefix = `sessions/${sessionId}/`

  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: 1000,
  })

  const response = await s3.send(command)
  const objects: S3Object[] = []

  if (response.Contents) {
    for (const obj of response.Contents) {
      if (obj.Key && obj.Size !== undefined && obj.LastModified) {
        objects.push({
          bucket,
          key: obj.Key,
          size: BigInt(obj.Size),
          lastModified: obj.LastModified,
        })
      }
    }
  }

  log.debug({ sessionId, count: objects.length }, "Listed session S3 objects")

  return objects
}

/**
 * Upload a file to a session's S3 prefix using streaming multipart upload.
 */
export async function uploadSessionFile(
  sessionId: string,
  filename: string,
  body: ReadableStream<Uint8Array>,
  contentLength: number,
  mimeType?: string
): Promise<{ bucket: string; key: string }> {
  if (!config.sessionFiles) {
    throw new Error("Session files not configured")
  }

  const s3 = getS3Client()
  const bucket = config.sessionFiles.bucket
  const key = buildSessionS3Key(sessionId, filename)

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    },
  })

  await upload.done()

  log.debug({ sessionId, filename, size: contentLength }, "Uploaded file to S3")

  return { bucket, key }
}

/**
 * Delete a file from S3.
 */
export async function deleteFile(bucket: string, key: string): Promise<void> {
  const s3 = getS3Client()

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  await s3.send(command)

  log.debug({ bucket, key }, "Deleted file from S3")
}

/**
 * Generate a presigned URL for downloading a file.
 */
export async function getPresignedDownloadUrl(bucket: string, key: string, expiresInSeconds: number = 900): Promise<string> {
  const s3 = getS3Client()

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  const url = await getSignedUrl(s3, command, { expiresIn: expiresInSeconds })

  log.debug({ bucket, key, expiresInSeconds }, "Generated presigned download URL")

  return url
}

/**
 * Guess MIME type from filename extension.
 * TODO: Use ImageMagick or similar for better mime type detection
 */
export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    json: "application/json",
    zip: "application/zip",
  }
  return ext ? (mimeTypes[ext] ?? "text/plain") : "text/plain"
}
