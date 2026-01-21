import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { generateUuid, uuidToSessionId } from "@/lib/id"
import { GET, PATCH, DELETE } from "./route"
import { TEST_USER_ID } from "../../../../../../vitest.setup"

describe("GET /api/v1/sessions/[id]", () => {
  const testEnvId = generateUuid()
  const testSessionId = generateUuid()

  beforeAll(async () => {
    await prisma.environment.create({
      data: { id: testEnvId, name: "Test Env", kind: "local", state: "active", userId: TEST_USER_ID },
    })
    await prisma.session.create({
      data: {
        id: testSessionId,
        title: "Test Session",
        environmentId: testEnvId,
        userId: TEST_USER_ID,
        status: "idle",
        sessionContext: { model: "test", sources: [], outcomes: [], allowed_tools: [], disallowed_tools: [], cwd: "" },
      },
    })
  })

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { environmentId: testEnvId } })
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  it("returns session by ID", async () => {
    const request = new NextRequest("http://localhost")
    const response = await GET(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.title).toBe("Test Session")
  })

  it("returns 404 for non-existent session", async () => {
    const request = new NextRequest("http://localhost")
    const response = await GET(request, { params: Promise.resolve({ id: uuidToSessionId(generateUuid()) }) })

    expect(response.status).toBe(404)
  })
})

describe("PATCH /api/v1/sessions/[id]", () => {
  const testEnvId = generateUuid()
  const testSessionId = generateUuid()

  beforeAll(async () => {
    await prisma.environment.create({
      data: { id: testEnvId, name: "Test Env", kind: "local", state: "active", userId: TEST_USER_ID },
    })
    await prisma.session.create({
      data: {
        id: testSessionId,
        title: "Original Title",
        environmentId: testEnvId,
        userId: TEST_USER_ID,
        status: "idle",
        sessionContext: { model: "test", sources: [], outcomes: [], allowed_tools: [], disallowed_tools: [], cwd: "" },
      },
    })
  })

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { environmentId: testEnvId } })
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  it("updates session title", async () => {
    const request = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated Title" }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.title).toBe("Updated Title")
  })
})

describe("DELETE /api/v1/sessions/[id]", () => {
  const testEnvId = generateUuid()

  beforeAll(async () => {
    await prisma.environment.create({
      data: { id: testEnvId, name: "Test Env", kind: "local", state: "active", userId: TEST_USER_ID },
    })
  })

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { environmentId: testEnvId } })
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  it("soft deletes session", async () => {
    const sessionId = generateUuid()
    await prisma.session.create({
      data: {
        id: sessionId,
        environmentId: testEnvId,
        userId: TEST_USER_ID,
        status: "idle",
        sessionContext: { model: "test", sources: [], outcomes: [], allowed_tools: [], disallowed_tools: [], cwd: "" },
      },
    })

    const request = new NextRequest("http://localhost", { method: "DELETE" })
    const response = await DELETE(request, { params: Promise.resolve({ id: uuidToSessionId(sessionId) }) })

    expect(response.status).toBe(200)

    // Verify soft delete - session still exists but status is "deleted"
    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    expect(session?.status).toBe("deleted")
  })
})
