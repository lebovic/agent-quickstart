import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { generateUuid, uuidToSessionId } from "@/lib/id"
import { generateSessionJwt } from "@/lib/auth/jwt"
import { GET, PUT } from "./route"
import { TEST_USER_ID } from "../../../../../../../vitest.setup"

describe("session_ingress", () => {
  const testEnvId = generateUuid()
  const testSessionId = generateUuid()
  const otherSessionId = generateUuid()
  let validToken: string
  let otherSessionToken: string

  beforeAll(async () => {
    await prisma.environment.create({
      data: { id: testEnvId, name: "Test Env", kind: "docker", state: "active", userId: TEST_USER_ID },
    })
    const session = await prisma.session.create({
      data: {
        id: testSessionId,
        environmentId: testEnvId,
        status: "running",
        sessionContext: { model: "test", sources: [], outcomes: [], allowed_tools: [], disallowed_tools: [], cwd: "" },
      },
    })
    validToken = generateSessionJwt(session)

    // Create another session for testing session mismatch
    const otherSession = await prisma.session.create({
      data: {
        id: otherSessionId,
        environmentId: testEnvId,
        status: "running",
        sessionContext: { model: "test", sources: [], outcomes: [], allowed_tools: [], disallowed_tools: [], cwd: "" },
      },
    })
    otherSessionToken = generateSessionJwt(otherSession)
  })

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { sessionId: { in: [testSessionId, otherSessionId] } } })
    await prisma.session.deleteMany({ where: { environmentId: testEnvId } })
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  describe("authentication", () => {
    it("GET returns 401 without token", async () => {
      const request = new NextRequest("http://localhost")
      const response = await GET(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      expect(response.status).toBe(401)
    })

    it("PUT returns 401 without token", async () => {
      const request = new NextRequest("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ uuid: generateUuid(), type: "user" }),
      })
      const response = await PUT(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      expect(response.status).toBe(401)
    })

    it("GET returns 401 with invalid token", async () => {
      const request = new NextRequest("http://localhost", {
        headers: { Authorization: "Bearer invalid-token" },
      })
      const response = await GET(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      expect(response.status).toBe(401)
    })

    it("PUT returns 401 with invalid token", async () => {
      const request = new NextRequest("http://localhost", {
        method: "PUT",
        headers: { Authorization: "Bearer invalid-token" },
        body: JSON.stringify({ uuid: generateUuid(), type: "user" }),
      })
      const response = await PUT(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      expect(response.status).toBe(401)
    })

    it("GET returns 401 with token for different session", async () => {
      const request = new NextRequest("http://localhost", {
        headers: { Authorization: `Bearer ${otherSessionToken}` },
      })
      const response = await GET(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      expect(response.status).toBe(401)
    })

    it("PUT returns 401 with token for different session", async () => {
      const request = new NextRequest("http://localhost", {
        method: "PUT",
        headers: { Authorization: `Bearer ${otherSessionToken}` },
        body: JSON.stringify({ uuid: generateUuid(), type: "user" }),
      })
      const response = await PUT(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      expect(response.status).toBe(401)
    })
  })

  describe("authorized requests", () => {
    it("PUT appends event", async () => {
      const eventUuid = generateUuid()
      const request = new NextRequest("http://localhost", {
        method: "PUT",
        headers: { Authorization: `Bearer ${validToken}` },
        body: JSON.stringify({
          uuid: eventUuid,
          type: "user",
          session_id: testSessionId,
          message: { role: "user", content: "Hello" },
        }),
      })

      const response = await PUT(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it("GET returns loglines", async () => {
      const request = new NextRequest("http://localhost", {
        headers: { Authorization: `Bearer ${validToken}` },
      })
      const response = await GET(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.loglines.length).toBeGreaterThanOrEqual(1)
    })

    it("PUT validates Last-Uuid header", async () => {
      const request = new NextRequest("http://localhost", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Last-Uuid": "wrong-uuid",
        },
        body: JSON.stringify({
          uuid: generateUuid(),
          type: "user",
          message: { role: "user", content: "Test" },
        }),
      })

      const response = await PUT(request, { params: Promise.resolve({ id: uuidToSessionId(testSessionId) }) })
      expect(response.status).toBe(500)
    })
  })
})
