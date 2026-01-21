import { describe, it, expect } from "vitest"
import { parseEventData } from "./event"

describe("parseEventData", () => {
  it("parses valid event", () => {
    const event = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      type: "user",
      session_id: "abc123",
      message: { role: "user", content: "Hello" },
    }

    const result = parseEventData(event)
    expect(result.uuid).toBe(event.uuid)
    expect(result.type).toBe("user")
  })

  it("rejects missing uuid", () => {
    expect(() => parseEventData({ type: "user" })).toThrow()
  })

  it("rejects missing type", () => {
    expect(() => parseEventData({ uuid: "abc" })).toThrow()
  })
})
