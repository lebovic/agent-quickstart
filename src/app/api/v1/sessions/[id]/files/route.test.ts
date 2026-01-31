import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { TEST_USER_ID } from "../../../../../../../vitest.setup"
import { uuidToSessionId, uuidToFileId, generateUuid } from "@/lib/id"
import { GET, POST } from "./route"

// Mock S3 operations
vi.mock("@/lib/s3/sync", () => ({
  syncSessionFiles: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/s3/operations", () => ({
  uploadSessionFile: vi.fn().mockResolvedValue({
    bucket: "test-bucket",
    key: "sessions/test-uuid/test.txt",
  }),
  guessMimeType: vi.fn().mockReturnValue("text/plain"),
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

// Test fixtures - scoped to each describe block
let testEnvUuid: string
let testSessionUuid: string
let testSessionId: string

async function createTestEnvironment(): Promise<string> {
  const envUuid = generateUuid()
  await prisma.environment.create({
    data: {
      id: envUuid,
      name: "Test Environment",
      userId: TEST_USER_ID,
    },
  })
  return envUuid
}

async function createTestSession(envId: string, title: string): Promise<{ uuid: string; id: string }> {
  const uuid = generateUuid()
  await prisma.session.create({
    data: {
      id: uuid,
      title,
      environmentId: envId,
      userId: TEST_USER_ID,
      sessionContext: {},
      storageUsedBytes: 0,
      storageQuotaBytes: 104857600,
    },
  })
  return { uuid, id: uuidToSessionId(uuid) }
}

describe("GET /api/v1/sessions/[id]/files", () => {
  beforeAll(async () => {
    testEnvUuid = await createTestEnvironment()
    const session = await createTestSession(testEnvUuid, "Files Test Session")
    testSessionUuid = session.uuid
    testSessionId = session.id
  })

  afterAll(async () => {
    await prisma.file.deleteMany({ where: { originSessionId: testSessionUuid } })
    await prisma.session.delete({ where: { id: testSessionUuid } })
    await prisma.environment.delete({ where: { id: testEnvUuid } })
  })

  beforeEach(async () => {
    await prisma.file.deleteMany({ where: { originSessionId: testSessionUuid } })
  })

  it("returns empty list when no files exist", async () => {
    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files`)
    const response = await GET(request, { params: Promise.resolve({ id: testSessionId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.first_id).toBeNull()
    expect(body.last_id).toBeNull()
    expect(body.has_more).toBe(false)
  })

  it("returns files for session", async () => {
    const file = await prisma.file.create({
      data: {
        s3Bucket: "test-bucket",
        s3Key: "sessions/test/test.txt",
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 1234,
        originSessionId: testSessionUuid,
      },
    })

    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files`)
    const response = await GET(request, { params: Promise.resolve({ id: testSessionId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].type).toBe("file")
    expect(body.data[0].id).toBe(uuidToFileId(file.id))
    expect(body.data[0].filename).toBe("test.txt")
    expect(body.data[0].mime_type).toBe("text/plain")
    expect(body.data[0].size_bytes).toBe(1234)
    expect(body.first_id).toBe(uuidToFileId(file.id))
    expect(body.last_id).toBe(uuidToFileId(file.id))
  })

  it("returns 400 for invalid session ID", async () => {
    const request = new NextRequest("http://localhost/api/v1/sessions/invalid/files")
    const response = await GET(request, { params: Promise.resolve({ id: "invalid" }) })

    expect(response.status).toBe(400)
  })

  it("returns 404 for non-existent session", async () => {
    const fakeId = uuidToSessionId(NON_EXISTENT_UUID)
    const request = new NextRequest(`http://localhost/api/v1/sessions/${fakeId}/files`)
    const response = await GET(request, { params: Promise.resolve({ id: fakeId }) })

    expect(response.status).toBe(404)
  })
})

describe("POST /api/v1/sessions/[id]/files", () => {
  beforeAll(async () => {
    testEnvUuid = await createTestEnvironment()
    const session = await createTestSession(testEnvUuid, "Upload Test Session")
    testSessionUuid = session.uuid
    testSessionId = session.id
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

  it("uploads file and creates database record", async () => {
    const formData = new FormData()
    const fileContent = new Blob(["Hello, World!"], { type: "text/plain" })
    formData.append("file", new File([fileContent], "hello.txt", { type: "text/plain" }))

    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files`, {
      method: "POST",
      body: formData,
    })

    const response = await POST(request, { params: Promise.resolve({ id: testSessionId }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.type).toBe("file")
    expect(body.filename).toBe("hello.txt")
    expect(body.mime_type).toBe("text/plain")

    const dbFile = await prisma.file.findFirst({
      where: { originSessionId: testSessionUuid, filename: "hello.txt" },
    })
    expect(dbFile).not.toBeNull()
  })

  it("increments storage used bytes", async () => {
    const formData = new FormData()
    const fileContent = new Blob(["test content"], { type: "text/plain" })
    formData.append("file", new File([fileContent], "test.txt", { type: "text/plain" }))

    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files`, {
      method: "POST",
      body: formData,
    })

    await POST(request, { params: Promise.resolve({ id: testSessionId }) })

    const session = await prisma.session.findUnique({ where: { id: testSessionUuid } })
    expect(Number(session?.storageUsedBytes)).toBeGreaterThan(0)
  })

  it("returns 400 when no file provided", async () => {
    const formData = new FormData()

    const request = new NextRequest(`http://localhost/api/v1/sessions/${testSessionId}/files`, {
      method: "POST",
      body: formData,
    })

    const response = await POST(request, { params: Promise.resolve({ id: testSessionId }) })
    expect(response.status).toBe(400)
  })

  it("returns 400 for invalid session ID", async () => {
    const formData = new FormData()
    formData.append("file", new File(["test"], "test.txt"))

    const request = new NextRequest("http://localhost/api/v1/sessions/invalid/files", {
      method: "POST",
      body: formData,
    })

    const response = await POST(request, { params: Promise.resolve({ id: "invalid" }) })
    expect(response.status).toBe(400)
  })

  it("returns 404 for non-existent session", async () => {
    const fakeId = uuidToSessionId(NON_EXISTENT_UUID)
    const formData = new FormData()
    formData.append("file", new File(["test"], "test.txt"))

    const request = new NextRequest(`http://localhost/api/v1/sessions/${fakeId}/files`, {
      method: "POST",
      body: formData,
    })

    const response = await POST(request, { params: Promise.resolve({ id: fakeId }) })
    expect(response.status).toBe(404)
  })
})
