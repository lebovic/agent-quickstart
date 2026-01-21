import { describe, it, expect, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { envIdToUuid } from "@/lib/id"
import { POST } from "./route"

describe("POST /api/v1/environment_providers/[id]/create", () => {
  const createdEnvIds: string[] = []

  afterEach(async () => {
    if (createdEnvIds.length > 0) {
      await prisma.environment.deleteMany({
        where: { id: { in: createdEnvIds } },
      })
      createdEnvIds.length = 0
    }
  })

  it("creates an environment with local kind", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers/local/create", {
      method: "POST",
      body: JSON.stringify({ name: "New Local Env" }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: "local" }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.name).toBe("New Local Env")
    expect(body.kind).toBe("local")
    expect(body.state).toBe("active")
    expect(body.environment_id).toMatch(/^env_/)

    createdEnvIds.push(envIdToUuid(body.environment_id))
  })

  it("creates an environment with anthropic_cloud kind", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers/anthropic_cloud/create", {
      method: "POST",
      body: JSON.stringify({ name: "New Cloud Env" }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: "anthropic_cloud" }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.kind).toBe("anthropic_cloud")

    createdEnvIds.push(envIdToUuid(body.environment_id))
  })

  it("creates an environment with config", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers/local/create", {
      method: "POST",
      body: JSON.stringify({
        name: "Configured Env",
        config: {
          cwd: "/workspace",
          languages: [
            { name: "python", version: "3.11" },
            { name: "node", version: "20" },
          ],
        },
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: "local" }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.config).toEqual({
      cwd: "/workspace",
      languages: [
        { name: "python", version: "3.11" },
        { name: "node", version: "20" },
      ],
    })

    createdEnvIds.push(envIdToUuid(body.environment_id))
  })

  it("returns 400 for invalid kind", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers/invalid/create", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: "invalid" }) })

    expect(response.status).toBe(400)
  })

  it("returns 400 for missing name", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers/local/create", {
      method: "POST",
      body: JSON.stringify({}),
    })
    const response = await POST(request, { params: Promise.resolve({ id: "local" }) })

    expect(response.status).toBe(400)
  })

  it("returns 400 for empty name", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers/local/create", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: "local" }) })

    expect(response.status).toBe(400)
  })
})
