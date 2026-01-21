import { describe, it, expect } from "vitest"
import { SessionStatus, CreateSessionRequest } from "./session"

describe("SessionStatus", () => {
  it("accepts valid statuses", () => {
    expect(SessionStatus.parse("idle")).toBe("idle")
    expect(SessionStatus.parse("running")).toBe("running")
  })

  it("rejects invalid status", () => {
    expect(() => SessionStatus.parse("invalid")).toThrow()
  })
})

describe("CreateSessionRequest", () => {
  it("parses minimal request", () => {
    const result = CreateSessionRequest.parse({
      environment_id: "env_abc123",
      session_context: { model: "claude-sonnet-4-5-20250929" },
    })

    expect(result.title).toBe("")
    expect(result.session_context.sources).toEqual([])
  })

  it("rejects missing environment_id", () => {
    expect(() =>
      CreateSessionRequest.parse({
        session_context: { model: "claude-sonnet-4-5-20250929" },
      })
    ).toThrow()
  })
})
