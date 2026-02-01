import { z } from "zod"
import type { File as PrismaFile } from "@prisma/client"
import { uuidToFileId } from "@/lib/id"
import { extractSource } from "@/lib/s3/operations"

export const FileResponse = z.object({
  type: z.literal("file"),
  id: z.string(),
  filename: z.string(),
  mime_type: z.string().nullable(),
  size_bytes: z.number(),
  source: z.enum(["user", "agent"]),
  created_at: z.string(),
  deleted_at: z.string().nullable().optional(),
})

export const ListFilesResponse = z.object({
  data: z.array(FileResponse),
  first_id: z.string().nullable(),
  last_id: z.string().nullable(),
  has_more: z.boolean(),
})

export const PresignedUrlResponse = z.object({
  type: z.literal("file_download_url"),
  url: z.string(),
  expires_at: z.string(),
})

export type FileResponse = z.infer<typeof FileResponse>
export type ListFilesResponse = z.infer<typeof ListFilesResponse>
export type PresignedUrlResponse = z.infer<typeof PresignedUrlResponse>

export function toApiFile(file: PrismaFile): FileResponse {
  return {
    type: "file",
    id: uuidToFileId(file.id),
    filename: file.filename,
    mime_type: file.mimeType,
    size_bytes: Number(file.sizeBytes),
    source: extractSource(file.s3Key),
    created_at: file.createdAt.toISOString(),
    deleted_at: file.deletedAt?.toISOString() ?? null,
  }
}
