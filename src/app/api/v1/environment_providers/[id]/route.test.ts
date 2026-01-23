import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { generateUuid, uuidToEnvId } from "@/lib/id"
import { encryptConfig } from "@/lib/schemas/environment"
import { GET, POST } from "./route"
import { TEST_USER_ID } from "../../../../../../vitest.setup"

describe("GET /api/v1/environment_providers/[id]", () => {
  const testEnvId = generateUuid()

  beforeAll(async () => {
    await prisma.environment.create({
      data: {
        id: testEnvId,
        name: "Test Env",
        kind: "docker",
        state: "active",
        configEnc: encryptConfig({ cwd: "/test" }),
        userId: TEST_USER_ID,
      },
    })
  })

  afterAll(async () => {
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  it("returns environment by ID", async () => {
    const envId = uuidToEnvId(testEnvId)
    const request = new NextRequest(`http://dockerhost/api/v1/environment_providers/${envId}`)
    const response = await GET(request, { params: Promise.resolve({ id: envId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.environment_id).toBe(envId)
    expect(body.name).toBe("Test Env")
    expect(body.kind).toBe("docker")
    expect(body.state).toBe("active")
  })

  it("returns config in single response", async () => {
    const envId = uuidToEnvId(testEnvId)
    const request = new NextRequest(`http://dockerhost/api/v1/environment_providers/${envId}`)
    const response = await GET(request, { params: Promise.resolve({ id: envId }) })
    const body = await response.json()

    expect(body.config).toEqual({ cwd: "/test" })
  })

  it("returns 404 for non-existent environment", async () => {
    const envId = uuidToEnvId(generateUuid())
    const request = new NextRequest(`http://dockerhost/api/v1/environment_providers/${envId}`)
    const response = await GET(request, { params: Promise.resolve({ id: envId }) })

    expect(response.status).toBe(404)
  })

  it("returns 400 for invalid ID format", async () => {
    const request = new NextRequest("http://dockerhost/api/v1/environment_providers/invalid")
    const response = await GET(request, { params: Promise.resolve({ id: "invalid" }) })

    expect(response.status).toBe(400)
  })
})

describe("POST /api/v1/environment_providers/[id]", () => {
  const testEnvId = generateUuid()

  beforeAll(async () => {
    await prisma.environment.create({
      data: {
        id: testEnvId,
        name: "Original Name",
        kind: "docker",
        state: "active",
        userId: TEST_USER_ID,
      },
    })
  })

  afterAll(async () => {
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  it("updates environment name", async () => {
    const envId = uuidToEnvId(testEnvId)
    const request = new NextRequest(`http://dockerhost/api/v1/environment_providers/${envId}`, {
      method: "POST",
      body: JSON.stringify({ name: "Updated Name" }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: envId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.name).toBe("Updated Name")
  })

  it("updates environment config", async () => {
    const envId = uuidToEnvId(testEnvId)
    const request = new NextRequest(`http://dockerhost/api/v1/environment_providers/${envId}`, {
      method: "POST",
      body: JSON.stringify({ config: { cwd: "/updated" } }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: envId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.config).toEqual({ cwd: "/updated" })
  })

  it("returns 404 for non-existent environment", async () => {
    const envId = uuidToEnvId(generateUuid())
    const request = new NextRequest(`http://dockerhost/api/v1/environment_providers/${envId}`, {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: envId }) })

    expect(response.status).toBe(404)
  })

  it("returns 400 for invalid request body", async () => {
    const envId = uuidToEnvId(testEnvId)
    const request = new NextRequest(`http://dockerhost/api/v1/environment_providers/${envId}`, {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: envId }) })

    expect(response.status).toBe(400)
  })
})
