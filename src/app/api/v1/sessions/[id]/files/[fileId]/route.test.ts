import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { TEST_USER_ID } from "../../../../../../../../vitest.setup"
import { uuidToSessionId, uuidToFileId, generateUuid } from "@/lib/id"
import { DELETE } from "./route"
import { POST } from "../route"

// Mock S3 operations
vi.mock("@/lib/s3/operations", () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
  uploadSessionFile: vi.fn().mockImplementation((sessionId, filename) => ({
    bucket: "test-bucket",
    key: `sessions/${sessionId}/user/${filename}`,
  })),
  guessMimeType: vi.fn().mockReturnValue("text/plain"),
  extractSource: vi.fn().mockReturnValue("user"),
}))

vi.mock("@/lib/s3/sync", () => ({
  syncSessionFiles: vi.fn().mockResolvedValue(undefined),
}))

// Mock config to enable sessionFiles
vi.mock("@/config", () => ({
  config: {
    logLevel: "silent",
    sessionFiles: {
      bucket: "test-bucket",
      region: "us-east-1",
      roleArn: "arn:aws:iam::123456789:role/test-role",
      quotaBytes: 104857600,
      maxFileSizeBytes: 52428800,
    },
  },
}))

const NON_EXISTENT_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

let testEnvUuid: string
let testSessionId: string
let testSessionUuid: string

describe("DELETE /api/v1/sessions/[id]/files/[fileId]", () => {
  beforeAll(async () => {
    testEnvUuid = generateUuid()
    await prisma.environment.create({
      data: {
        id: testEnvUuid,
        name: "Delete File Test Environment",
        userId: TEST_USER_ID,
      },
    })

    testSessionUuid = generateUuid()
    await prisma.session.create({
      data: {
        id: testSessionUuid,
        title: "Delete File Test Session",
        environmentId: testEnvUuid,
        userId: TEST_USER_ID,
        sessionContext: {},
        storageUsedBytes: 0,
        storageQuotaBytes: 104857600,
      },
    })
    testSessionId = uuidToSessionId(testSessionUuid)
  })

  afterAll(async () => {
    await prisma.file.deleteMany({ where: { originSessionId: testSessionUuid } })
    await prisma.session.delete({ where: { id: testSessionUuid } })
    await prisma.environment.delete({ where: { id: testEnvUuid } })
  })

  beforeEach(async () => {
    await prisma.file.deleteMany({ where: { originSessionId: testSessionUuid } })
    await prisma.session.update({
      where: { id: testSessionUuid },
      data: { storageUsedBytes: 0 },
    })
  })

  it("deletes file and sets deletedAt", async () => {
    const file = await prisma.file.create({
      data: {
        s3Bucket: "test-bucket",
        s3Key: `sessions/${testSessionUuid}/user/test.txt`,
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 1000,
        originSessionId: testSessionUuid,
      },
    })
    await prisma.session.update({
      where: { id: testSessionUuid },
      data: { storageUsedBytes: 1000 },
    })
    const fileId = uuidToFileId(file.id)

    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/${fileId}`, {
      method: "DELETE",
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: testSessionId, fileId }),
    })

    expect(response.status).toBe(204)

    // Verify soft delete
    const deletedFile = await prisma.file.findUnique({ where: { id: file.id } })
    expect(deletedFile).not.toBeNull()
    expect(deletedFile?.deletedAt).not.toBeNull()

    // Verify storage decremented
    const session = await prisma.session.findUnique({ where: { id: testSessionUuid } })
    expect(Number(session?.storageUsedBytes)).toBe(0)
  })

  it("returns 404 for already deleted file", async () => {
    const file = await prisma.file.create({
      data: {
        s3Bucket: "test-bucket",
        s3Key: `sessions/${testSessionUuid}/user/deleted.txt`,
        filename: "deleted.txt",
        mimeType: "text/plain",
        sizeBytes: 500,
        originSessionId: testSessionUuid,
        deletedAt: new Date(),
      },
    })
    const fileId = uuidToFileId(file.id)

    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/${fileId}`, {
      method: "DELETE",
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: testSessionId, fileId }),
    })

    expect(response.status).toBe(404)
  })

  it("returns 404 for non-existent file", async () => {
    const fakeFileId = uuidToFileId(NON_EXISTENT_UUID)

    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/${fakeFileId}`, {
      method: "DELETE",
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: testSessionId, fileId: fakeFileId }),
    })

    expect(response.status).toBe(404)
  })

  it("returns 400 for invalid session ID", async () => {
    const fakeFileId = uuidToFileId(NON_EXISTENT_UUID)

    const request = new NextRequest(`http://localhost/api/v1/sessions/invalid/files/${fakeFileId}`, {
      method: "DELETE",
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: "invalid", fileId: fakeFileId }),
    })

    expect(response.status).toBe(400)
  })

  it("returns 400 for invalid file ID", async () => {
    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/invalid`, {
      method: "DELETE",
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: testSessionId, fileId: "invalid" }),
    })

    expect(response.status).toBe(400)
  })

  it("allows re-upload after delete", async () => {
    // Create and delete a file
    const file = await prisma.file.create({
      data: {
        s3Bucket: "test-bucket",
        s3Key: `sessions/${testSessionUuid}/user/reupload.txt`,
        filename: "reupload.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        originSessionId: testSessionUuid,
      },
    })
    const fileId = uuidToFileId(file.id)

    // Delete the file
    const deleteRequest = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/${fileId}`, {
      method: "DELETE",
    })
    const deleteResponse = await DELETE(deleteRequest, {
      params: Promise.resolve({ id: testSessionId, fileId }),
    })
    expect(deleteResponse.status).toBe(204)

    // Re-upload with same filename
    const formData = new FormData()
    const fileContent = new Blob(["new content"], { type: "text/plain" })
    formData.append("file", new File([fileContent], "reupload.txt", { type: "text/plain" }))

    const uploadRequest = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files`, {
      method: "POST",
      body: formData,
    })
    const uploadResponse = await POST(uploadRequest, {
      params: Promise.resolve({ id: testSessionId }),
    })

    expect(uploadResponse.status).toBe(201)
    const body = await uploadResponse.json()
    expect(body.filename).toBe("reupload.txt")

    // Verify we now have two records: one deleted, one active
    const allFiles = await prisma.file.findMany({
      where: { originSessionId: testSessionUuid, filename: "reupload.txt" },
    })
    expect(allFiles).toHaveLength(2)
    expect(allFiles.filter((f) => f.deletedAt !== null)).toHaveLength(1)
    expect(allFiles.filter((f) => f.deletedAt === null)).toHaveLength(1)
  })
})
