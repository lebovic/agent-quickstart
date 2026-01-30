import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { generateUuid, uuidToEnvId } from "@/lib/id"
import { GET, POST } from "./route"
import { TEST_USER_ID } from "../../../../../vitest.setup"

// Mock git integration to optional so tests don't require repos
vi.mock("@/lib/git/mode", () => ({
  isGitIntegrationRequired: () => false,
}))

describe("GET /api/v1/sessions", () => {
  const testEnvId = generateUuid()
  const testSessionIds: string[] = []

  beforeAll(async () => {
    await prisma.environment.create({
      data: { id: testEnvId, name: "Test Env", kind: "docker", state: "active", userId: TEST_USER_ID },
    })

    for (let i = 0; i < 3; i++) {
      const id = generateUuid()
      testSessionIds.push(id)
      await prisma.session.create({
        data: {
          id,
          title: `Test Session ${i}`,
          environmentId: testEnvId,
          userId: TEST_USER_ID,
          status: "idle",
          sessionContext: { model: "test", sources: [], outcomes: [], allowed_tools: [], disallowed_tools: [], cwd: "" },
        },
      })
    }
  })

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { environmentId: testEnvId } })
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  it("returns sessions", async () => {
    const request = new NextRequest("http://localhost/api/v1/sessions")
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.length).toBeGreaterThanOrEqual(3)
  })

  it("respects limit parameter", async () => {
    const request = new NextRequest("http://localhost/api/v1/sessions?limit=2")
    const response = await GET(request)
    const body = await response.json()

    expect(body.data.length).toBe(2)
    expect(body.has_more).toBe(true)
  })
})

describe("POST /api/v1/sessions", () => {
  const testEnvId = generateUuid()

  beforeAll(async () => {
    await prisma.environment.create({
      data: { id: testEnvId, name: "Test Env", kind: "docker", state: "active", userId: TEST_USER_ID },
    })
  })

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { environmentId: testEnvId } })
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  it("creates a session", async () => {
    const request = new NextRequest("http://localhost/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        title: "New Session",
        environment_id: uuidToEnvId(testEnvId),
        session_context: { model: "claude-sonnet-4-5-20250929" },
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.title).toBe("New Session")
    expect(body.session_status).toBe("idle")
    expect(body.id).toMatch(/^session_/)
  })

  it("returns 400 for invalid request", async () => {
    const request = new NextRequest("http://localhost/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Missing fields" }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it("returns 404 for non-existent environment", async () => {
    const request = new NextRequest("http://localhost/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        environment_id: uuidToEnvId(generateUuid()),
        session_context: { model: "claude-sonnet-4-5-20250929" },
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(404)
  })
})
