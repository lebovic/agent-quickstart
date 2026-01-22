import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock logger
vi.mock("@/lib/logger", () => ({
  log: {
    warn: vi.fn(),
  },
}))

describe("generateSessionTitle", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
    vi.resetModules()
    vi.useRealTimers()
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
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: "Fix login bug in auth module" }] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Help me fix the login bug in auth.ts")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Fix login bug in auth module")
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-key": "test-api-key",
          }),
        })
      )
    })

    it("returns fallback on API error", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("returns fallback on fetch exception", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"))
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when response has empty title", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: "" }] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when response has very long title", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: "a".repeat(250) }] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when content array is empty", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when content is null", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: null }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when content item has no text property", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ type: "text" }] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("returns fallback when title is not a string", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: 123 }] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Some prompt")
    })

    it("truncates long prompts in fallback", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const longPrompt = "a".repeat(150)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle(longPrompt)
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("a".repeat(100) + "...")
      expect(title.length).toBe(103)
    })

    it("truncates prompt to 500 chars when sending to API", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const longPrompt = "x".repeat(600)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: "Generated title" }] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle(longPrompt)
      await vi.runAllTimersAsync()
      await titlePromise

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.messages[0].content).toContain("x".repeat(500))
      expect(callBody.messages[0].content).not.toContain("x".repeat(501))
    })

    it("trims whitespace from generated title", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: "  Generated title with spaces  " }] }),
      })
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.runAllTimersAsync()
      const title = await titlePromise

      expect(title).toBe("Generated title with spaces")
    })

    it("returns fallback on timeout", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const mockFetch = vi.fn().mockImplementation(
        (_url, options) =>
          new Promise((resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"))
            })
          })
      )
      vi.stubGlobal("fetch", mockFetch)

      const titlePromise = generateSessionTitle("Some prompt")
      await vi.advanceTimersByTimeAsync(5000)
      const title = await titlePromise

      expect(title).toBe("Some prompt")
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
    })

    it("truncates long prompt in fallback when API key is missing", async () => {
      const { generateSessionTitle } = await import("./generate-title")
      const longPrompt = "b".repeat(150)

      const title = await generateSessionTitle(longPrompt)

      expect(title).toBe("b".repeat(100) + "...")
    })
  })
})
