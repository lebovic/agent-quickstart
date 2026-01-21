import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { generateUuid } from "@/lib/id"
import { GET } from "./route"
import { TEST_USER_ID } from "../../../../../vitest.setup"

describe("GET /api/v1/environment_providers", () => {
  const testEnvIds: string[] = []

  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const id = generateUuid()
      testEnvIds.push(id)
      await prisma.environment.create({
        data: {
          id,
          name: `Test Env ${i}`,
          kind: "local",
          state: "active",
          userId: TEST_USER_ID,
        },
      })
    }
  })

  afterAll(async () => {
    await prisma.environment.deleteMany({
      where: { id: { in: testEnvIds } },
    })
  })

  it("returns environments", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers")
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.environments.length).toBeGreaterThanOrEqual(3)
    expect(body.environments[0]).toHaveProperty("environment_id")
    expect(body.environments[0]).toHaveProperty("kind")
    expect(body.environments[0]).toHaveProperty("name")
  })

  it("respects limit parameter", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers?limit=2")
    const response = await GET(request)
    const body = await response.json()

    expect(body.environments.length).toBe(2)
    expect(body.has_more).toBe(true)
  })

  it("returns config as null in list response", async () => {
    const request = new NextRequest("http://localhost/api/v1/environment_providers")
    const response = await GET(request)
    const body = await response.json()

    expect(body.environments[0].config).toBeNull()
  })
})
