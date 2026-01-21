import { describe, it, expect } from "vitest"
import { generateUuid, uuidToSessionId, sessionIdToUuid, uuidToEnvId, envIdToUuid } from "./id"

describe("generateUuid", () => {
  it("generates valid UUID v4 format", () => {
    const uuid = generateUuid()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it("generates unique values", () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUuid()))
    expect(uuids.size).toBe(100)
  })
})

describe("session ID conversion", () => {
  const testUuid = "550e8400-e29b-41d4-a716-446655440000"

  it("converts UUID to session ID with base62 encoding", () => {
    const sessionId = uuidToSessionId(testUuid)
    expect(sessionId).toMatch(/^session_[0-9A-Za-z]{24}$/)
    expect(sessionId).toBe("session_002aUyqjCzEIiEcYMKj7TZtw")
  })

  it("converts session ID back to UUID", () => {
    const sessionId = "session_002aUyqjCzEIiEcYMKj7TZtw"
    const uuid = sessionIdToUuid(sessionId)
    expect(uuid).toBe(testUuid)
  })

  it("roundtrips correctly", () => {
    const uuid = generateUuid()
    const sessionId = uuidToSessionId(uuid)
    const recovered = sessionIdToUuid(sessionId)
    expect(recovered).toBe(uuid)
  })

  it("produces consistent 24-character base62 strings", () => {
    // Test with various UUIDs including edge cases
    const uuids = ["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff", generateUuid(), generateUuid()]

    for (const uuid of uuids) {
      const sessionId = uuidToSessionId(uuid)
      const encoded = sessionId.slice("session_".length)
      expect(encoded).toHaveLength(24)
      expect(encoded).toMatch(/^[0-9A-Za-z]+$/)
    }
  })

  it("throws on invalid session ID prefix", () => {
    expect(() => sessionIdToUuid("invalid_123")).toThrow("Invalid session ID format")
  })

  it("throws on invalid base62 characters", () => {
    expect(() => sessionIdToUuid("session_invalid!characters")).toThrow("Invalid base62 character")
  })
})

describe("environment ID conversion", () => {
  const testUuid = "550e8400-e29b-41d4-a716-446655440000"

  it("converts UUID to environment ID with base62 encoding", () => {
    const envId = uuidToEnvId(testUuid)
    expect(envId).toMatch(/^env_[0-9A-Za-z]{24}$/)
    expect(envId).toBe("env_002aUyqjCzEIiEcYMKj7TZtw")
  })

  it("converts environment ID back to UUID", () => {
    const envId = "env_002aUyqjCzEIiEcYMKj7TZtw"
    const uuid = envIdToUuid(envId)
    expect(uuid).toBe(testUuid)
  })

  it("roundtrips correctly", () => {
    const uuid = generateUuid()
    const envId = uuidToEnvId(uuid)
    const recovered = envIdToUuid(envId)
    expect(recovered).toBe(uuid)
  })

  it("throws on invalid environment ID prefix", () => {
    expect(() => envIdToUuid("invalid_123")).toThrow("Invalid environment ID format")
  })
})
