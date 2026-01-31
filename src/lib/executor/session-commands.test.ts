import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock config before importing the module under test
vi.mock("@/config", () => ({
  config: {
    apiUrlForExecutors: "http://localhost:3000",
    logLevel: "silent",
  },
}))

// Mock logger to avoid pino initialization issues
vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock JWT generation
vi.mock("@/lib/auth/jwt", () => ({
  generateSessionJwt: vi.fn().mockReturnValue("mock-token"),
}))

import { buildSessionCommands } from "./session-commands"
import type { Session } from "@prisma/client"
import type { SessionContext } from "@/lib/schemas/session"

describe("buildSessionCommands", () => {
  const mockSession: Session = {
    id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    title: "Test Session",
    environmentId: "test-env-id",
    userId: "test-user-id",
    status: "running",
    type: "internal_session",
    providerMode: "hosted",
    sessionContext: {},
    lastEventUuid: null,
    executorStatus: null,
    dockerContainerName: null,
    modalSandboxId: null,
    modalSnapshotId: null,
    storageUsedBytes: BigInt(0),
    storageQuotaBytes: BigInt(104857600),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const baseContext: SessionContext = {
    model: "claude-sonnet-4-5-20250929",
    sources: [],
    outcomes: [],
    allowed_tools: [],
    disallowed_tools: [],
    cwd: "",
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("git commands", () => {
    it("excludes git setup commands when no git sources exist", () => {
      const context: SessionContext = { ...baseContext, sources: [], outcomes: [] }
      const result = buildSessionCommands(mockSession, context)

      expect(result.setupCmd).toBe("")
      expect(result.workDir).toBe("/home/user")
    })

    it("includes git setup commands when git sources exist", () => {
      const context: SessionContext = {
        ...baseContext,
        sources: [{ type: "git_repository", url: "https://github.com/owner/repo" }],
        outcomes: [
          {
            type: "git_repository",
            git_info: { type: "github", repo: "owner/repo", branches: ["agent-test"] },
          },
        ],
      }
      const result = buildSessionCommands(mockSession, context)

      expect(result.setupCmd).toContain("git config")
      expect(result.setupCmd).toContain("git clone")
      expect(result.workDir).toBe("/home/user/repo")
    })

    it("sets correct workdir for cloned repository", () => {
      const context: SessionContext = {
        ...baseContext,
        sources: [{ type: "git_repository", url: "https://github.com/anthropics/claude-code" }],
        outcomes: [],
      }
      const result = buildSessionCommands(mockSession, context)

      expect(result.workDir).toBe("/home/user/claude-code")
    })
  })

  describe("claude command", () => {
    it("always includes claude CLI command", () => {
      const result = buildSessionCommands(mockSession, baseContext)

      expect(result.claudeCmd).toContain("exec claude")
      expect(result.claudeCmd).toContain("--output-format=stream-json")
      expect(result.claudeCmd).toContain("--model=claude-sonnet-4-5-20250929")
    })
  })

  describe("environment variables", () => {
    it("includes required auth environment variables", () => {
      const result = buildSessionCommands(mockSession, baseContext)

      expect(result.env.TOKEN).toBe("mock-token")
      expect(result.env.ANTHROPIC_API_KEY).toBe("mock-token")
      expect(result.env.ANTHROPIC_BASE_URL).toBe("http://localhost:3000/api/anthropic")
    })

    it("merges custom environment variables", () => {
      const customEnv = { CUSTOM_VAR: "custom-value" }
      const result = buildSessionCommands(mockSession, baseContext, customEnv)

      expect(result.env.CUSTOM_VAR).toBe("custom-value")
      expect(result.env.TOKEN).toBe("mock-token")
    })
  })
})
