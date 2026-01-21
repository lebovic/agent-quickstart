import { describe, it, expect } from "vitest"
import { parsePaginationParams, paginatedResponse } from "./pagination"

describe("parsePaginationParams", () => {
  const identity = (id: string) => id

  it("returns defaults when no params provided", () => {
    const params = new URLSearchParams()
    const result = parsePaginationParams(params, identity)

    expect(result).toEqual({
      limit: 50,
      cursor: undefined,
      skip: 0,
      take: 51,
    })
  })

  it("respects custom limit", () => {
    const params = new URLSearchParams({ limit: "10" })
    const result = parsePaginationParams(params, identity)

    expect(result.limit).toBe(10)
    expect(result.take).toBe(11)
  })

  it("handles after_id cursor", () => {
    const params = new URLSearchParams({ after_id: "abc123" })
    const result = parsePaginationParams(params, identity)

    expect(result.cursor).toEqual({ id: "abc123" })
    expect(result.skip).toBe(1)
  })

  it("handles before_id cursor with negative take", () => {
    const params = new URLSearchParams({ before_id: "abc123", limit: "10" })
    const result = parsePaginationParams(params, identity)

    expect(result.cursor).toEqual({ id: "abc123" })
    expect(result.skip).toBe(1)
    expect(result.take).toBe(-11)
  })

  it("uses custom idToUuid function", () => {
    const addPrefix = (id: string) => `uuid_${id}`
    const params = new URLSearchParams({ after_id: "123" })
    const result = parsePaginationParams(params, addPrefix)

    expect(result.cursor).toEqual({ id: "uuid_123" })
  })

  it("throws when idToUuid throws", () => {
    const alwaysThrow = () => {
      throw new Error("Invalid ID")
    }
    const params = new URLSearchParams({ after_id: "invalid" })

    expect(() => parsePaginationParams(params, alwaysThrow)).toThrow()
  })
})

describe("paginatedResponse", () => {
  it("returns all items when under limit", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }]
    const result = paginatedResponse(items, 10, (item) => item.id)

    expect(result).toEqual({
      data: items,
      has_more: false,
      first_id: "1",
      last_id: "3",
    })
  })

  it("indicates has_more when items exceed limit", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }]
    const result = paginatedResponse(items, 2, (item) => item.id)

    expect(result).toEqual({
      data: [{ id: "1" }, { id: "2" }],
      has_more: true,
      first_id: "1",
      last_id: "2",
    })
  })

  it("handles empty array", () => {
    const result = paginatedResponse([], 10, (item: { id: string }) => item.id)

    expect(result).toEqual({
      data: [],
      has_more: false,
    })
  })

  it("handles single item", () => {
    const items = [{ id: "only" }]
    const result = paginatedResponse(items, 10, (item) => item.id)

    expect(result).toEqual({
      data: items,
      has_more: false,
      first_id: "only",
      last_id: "only",
    })
  })
})
