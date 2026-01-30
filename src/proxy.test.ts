import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { GitIntegrationMode } from "@/lib/git/mode"

// Use vi.hoisted so mockConfig is available when vi.mock factory runs
const mockConfig = vi.hoisted(() => ({
  gitIntegrationMode: "optional" as GitIntegrationMode,
  deployUrl: "http://localhost:3000",
  logLevel: "silent",
}))

vi.mock("@/config", () => ({
  config: mockConfig,
}))

// Mock logger to avoid pino initialization issues
vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock prisma to avoid DB calls in rate limiting
vi.mock("@/lib/db", () => ({
  prisma: {
    rateLimit: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Mock auth
vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({ user: { id: "test-user" } }),
    },
  },
}))

import { proxy } from "./proxy"

function createRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`)
}

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("git integration mode", () => {
    const gitRoutes = [
      "/api/github/installation-url",
      "/api/auth/github",
      "/api/auth/github/callback",
      "/api/code/repos",
      "/api/code/repos/owner/repo/branches",
      "/api/git-proxy/owner/repo/info/refs",
    ]

    describe("when disabled", () => {
      beforeEach(() => {
        mockConfig.gitIntegrationMode = "disabled"
      })

      it.each(gitRoutes)("returns 404 for %s", async (path) => {
        const request = createRequest(path)
        const response = await proxy(request)

        expect(response.status).toBe(404)
        const body = await response.json()
        expect(body.error.message).toBe("Git integration is disabled")
      })

      it("allows non-git API routes", async () => {
        const request = createRequest("/api/v1/sessions")
        const response = await proxy(request)

        // Should not be 404 (will be NextResponse.next() which has no status in test)
        expect(response.status).not.toBe(404)
      })
    })

    describe("when enabled (optional or required)", () => {
      beforeEach(() => {
        mockConfig.gitIntegrationMode = "optional"
      })

      it.each(gitRoutes)("allows %s", async (path) => {
        const request = createRequest(path)
        const response = await proxy(request)

        expect(response.status).not.toBe(404)
      })
    })
  })
})
