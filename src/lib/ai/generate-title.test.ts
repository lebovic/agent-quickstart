import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock logger
vi.mock("@/lib/logger", () => ({
  log: {
    warn: vi.fn(),
  },
}))

// Mock Anthropic SDK - must be hoisted
const mockCreate = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  },
}))

describe("generateSessionTitle", () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe("with API key configured", () => {
    beforeEach(() => {
      vi.doMock("@/config", () => ({
        config: {
          anthropicApiKey: "test-api-key",
          anthropicApiUrl: "https://api.anthropic.com",
        },
      }))
    })

    it("returns generated title on successful API response", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Fix login bug in auth module" }],
      })
      const { generateSessionTitle } = await import("./generate-title")

      const title = await generateSessionTitle("Help me fix the login bug in auth.ts")

      expect(title).toBe("Fix login bug in auth module")
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 50,
        })
      )
    })

    it("returns fallback on API error", async () => {
      mockCreate.mockRejectedValue(new Error("API error"))
      const { generateSessionTitle } = await import("./generate-title")

      const title = await generateSessionTitle("Some prompt")

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when response has empty title", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "" }],
      })
      const { generateSessionTitle } = await import("./generate-title")

      const title = await generateSessionTitle("Some prompt")

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when response has very long title", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "a".repeat(250) }],
      })
      const { generateSessionTitle } = await import("./generate-title")

      const title = await generateSessionTitle("Some prompt")

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when content array is empty", async () => {
      mockCreate.mockResolvedValue({
        content: [],
      })
      const { generateSessionTitle } = await import("./generate-title")

      const title = await generateSessionTitle("Some prompt")

      expect(title).toBe("Some prompt")
    })

    it("truncates long prompts in fallback", async () => {
      mockCreate.mockRejectedValue(new Error("API error"))
      const { generateSessionTitle } = await import("./generate-title")
      const longPrompt = "a".repeat(150)

      const title = await generateSessionTitle(longPrompt)

      expect(title).toBe("a".repeat(100) + "...")
      expect(title.length).toBe(103)
    })

    it("truncates prompt to 500 chars when sending to API", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Generated title" }],
      })
      const { generateSessionTitle } = await import("./generate-title")
      const longPrompt = "x".repeat(600)

      await generateSessionTitle(longPrompt)

      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain("x".repeat(500))
      expect(callArgs.messages[0].content).not.toContain("x".repeat(501))
    })

    it("trims whitespace from generated title", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "  Generated title with spaces  " }],
      })
      const { generateSessionTitle } = await import("./generate-title")

      const title = await generateSessionTitle("Some prompt")

      expect(title).toBe("Generated title with spaces")
    })
  })

  describe("without API key configured", () => {
    beforeEach(() => {
      vi.doMock("@/config", () => ({
        config: {
          anthropicApiKey: "",
          anthropicApiUrl: "https://api.anthropic.com",
        },
      }))
    })

    it("returns fallback when API key is missing", async () => {
      const { generateSessionTitle } = await import("./generate-title")

      const title = await generateSessionTitle("A very long prompt that exceeds the limit")

      expect(title).toBe("A very long prompt that exceeds the limit")
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it("truncates long prompt in fallback when API key is missing", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const longPrompt = "b".repeat(150)

      const title = await generateSessionTitle(longPrompt)

      expect(title).toBe("b".repeat(100) + "...")
    })
  })
})
