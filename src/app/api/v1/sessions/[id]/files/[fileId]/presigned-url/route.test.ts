import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { TEST_USER_ID } from "../../../../../../../../../vitest.setup"
import { uuidToSessionId, uuidToFileId, generateUuid } from "@/lib/id"
import { GET } from "./route"

// Mock S3 operations
vi.mock("@/lib/s3/operations", () => ({
  getPresignedDownloadUrl: vi.fn().mockResolvedValue("https://test-bucket.s3.amazonaws.com/presigned-url"),
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

// Valid UUIDv4 that doesn't exist in the database
const NON_EXISTENT_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

let testEnvUuid: string
let testSessionId: string
let testSessionUuid: string
let testFileId: string

describe("GET /api/v1/sessions/[id]/files/[fileId]/presigned-url", () => {
  beforeAll(async () => {
    testEnvUuid = generateUuid()
    await prisma.environment.create({
      data: {
        id: testEnvUuid,
        name: "Presigned URL Test Environment",
        userId: TEST_USER_ID,
      },
    })

    testSessionUuid = generateUuid()
    await prisma.session.create({
      data: {
        id: testSessionUuid,
        title: "Presigned URL Test Session",
        environmentId: testEnvUuid,
        userId: TEST_USER_ID,
        sessionContext: {},
        storageUsedBytes: 0,
        storageQuotaBytes: 104857600,
      },
    })
    testSessionId = uuidToSessionId(testSessionUuid)

    const file = await prisma.file.create({
      data: {
        s3Bucket: "test-bucket",
        s3Key: "sessions/test/document.pdf",
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5678,
        originSessionId: testSessionUuid,
      },
    })
    testFileId = uuidToFileId(file.id)
  })

  afterAll(async () => {
    await prisma.file.deleteMany({ where: { originSessionId: testSessionUuid } })
    await prisma.session.delete({ where: { id: testSessionUuid } })
    await prisma.environment.delete({ where: { id: testEnvUuid } })
  })

  it("returns presigned download URL", async () => {
    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/${testFileId}/presigned-url`)
    const response = await GET(request, {
      params: Promise.resolve({ id: testSessionId, fileId: testFileId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.type).toBe("file_download_url")
    expect(body.url).toBe("https://test-bucket.s3.amazonaws.com/presigned-url")
    expect(body.expires_at).toBeDefined()

    const expiresAt = new Date(body.expires_at)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it("returns 400 for invalid session ID", async () => {
    const request = new NextRequest(`http://localhost/api/v1/sessions/invalid/files/${testFileId}/presigned-url`)
    const response = await GET(request, {
      params: Promise.resolve({ id: "invalid", fileId: testFileId }),
    })

    expect(response.status).toBe(400)
  })

  it("returns 400 for invalid file ID", async () => {
    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/invalid/presigned-url`)
    const response = await GET(request, {
      params: Promise.resolve({ id: testSessionId, fileId: "invalid" }),
    })

    expect(response.status).toBe(400)
  })

  it("returns 404 for non-existent session", async () => {
    const fakeSessionId = uuidToSessionId(NON_EXISTENT_UUID)
    const request = new NextRequest(`http://localhost/api/v1/sessions/${fakeSessionId}/files/${testFileId}/presigned-url`)
    const response = await GET(request, {
      params: Promise.resolve({ id: fakeSessionId, fileId: testFileId }),
    })

    expect(response.status).toBe(404)
  })

  it("returns 404 for non-existent file", async () => {
    const fakeFileId = uuidToFileId(NON_EXISTENT_UUID)
    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files/${fakeFileId}/presigned-url`)
    const response = await GET(request, {
      params: Promise.resolve({ id: testSessionId, fileId: fakeFileId }),
    })

    expect(response.status).toBe(404)
  })

  it("returns 404 for file belonging to different session", async () => {
    const otherEnvUuid = generateUuid()
    await prisma.environment.create({
      data: {
        id: otherEnvUuid,
        name: "Other Environment",
        userId: TEST_USER_ID,
      },
    })

    const otherSessionUuid = generateUuid()
    await prisma.session.create({
      data: {
        id: otherSessionUuid,
        title: "Other Session",
        environmentId: otherEnvUuid,
        userId: TEST_USER_ID,
        sessionContext: {},
        storageUsedBytes: 0,
        storageQuotaBytes: 104857600,
      },
    })
    const otherSessionId = uuidToSessionId(otherSessionUuid)

    try {
      const request = new NextRequest(`http://localhost/api/v1/sessions/${otherSessionId}/files/${testFileId}/presigned-url`)
      const response = await GET(request, {
        params: Promise.resolve({ id: otherSessionId, fileId: testFileId }),
      })

      expect(response.status).toBe(404)
    } finally {
      await prisma.session.delete({ where: { id: otherSessionUuid } })
      await prisma.environment.delete({ where: { id: otherEnvUuid } })
    }
  })
})
