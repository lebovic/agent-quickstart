import { describe, it, expect } from "vitest"
import { parseRefUpdates, extractBranchNames, extractBranchesFromPack } from "./pack-parser"

describe("parseRefUpdates", () => {
  const oldSha = "0000000000000000000000000000000000000000"
  const newSha = "1234567890abcdef1234567890abcdef12345678"

  function makePktLine(content: string): string {
    // Length includes the 4-byte header
    const length = content.length + 4
    return length.toString(16).padStart(4, "0") + content
  }

  it("parses a single ref update", () => {
    const line = `${oldSha} ${newSha} refs/heads/main\n`
    const data = Buffer.from(makePktLine(line) + "0000")

    const updates = parseRefUpdates(data)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      oldSha,
      newSha,
      refName: "refs/heads/main",
    })
  })

  it("parses multiple ref updates", () => {
    const line1 = `${oldSha} ${newSha} refs/heads/main\n`
    const line2 = `${newSha} ${oldSha} refs/heads/feature\n`
    const data = Buffer.from(makePktLine(line1) + makePktLine(line2) + "0000")

    const updates = parseRefUpdates(data)
    expect(updates).toHaveLength(2)
    expect(updates[0].refName).toBe("refs/heads/main")
    expect(updates[1].refName).toBe("refs/heads/feature")
  })

  it("handles capabilities after null byte", () => {
    const line = `${oldSha} ${newSha} refs/heads/main\0report-status side-band-64k\n`
    const data = Buffer.from(makePktLine(line) + "0000")

    const updates = parseRefUpdates(data)
    expect(updates).toHaveLength(1)
    expect(updates[0].refName).toBe("refs/heads/main")
  })

  it("handles tag refs", () => {
    const line = `${oldSha} ${newSha} refs/tags/v1.0.0\n`
    const data = Buffer.from(makePktLine(line) + "0000")

    const updates = parseRefUpdates(data)
    expect(updates).toHaveLength(1)
    expect(updates[0].refName).toBe("refs/tags/v1.0.0")
  })

  it("returns empty array for empty data", () => {
    const updates = parseRefUpdates(Buffer.from(""))
    expect(updates).toHaveLength(0)
  })

  it("returns empty array for just flush packet", () => {
    const updates = parseRefUpdates(Buffer.from("0000"))
    expect(updates).toHaveLength(0)
  })

  it("stops at flush packet", () => {
    const line = `${oldSha} ${newSha} refs/heads/main\n`
    // Add garbage after flush packet - should be ignored
    const data = Buffer.from(makePktLine(line) + "0000" + "garbage data")

    const updates = parseRefUpdates(data)
    expect(updates).toHaveLength(1)
  })

  it("skips invalid SHA format", () => {
    const line = `invalid ${newSha} refs/heads/main\n`
    const data = Buffer.from(makePktLine(line) + "0000")

    const updates = parseRefUpdates(data)
    expect(updates).toHaveLength(0)
  })

  it("skips refs not starting with refs/", () => {
    const line = `${oldSha} ${newSha} heads/main\n`
    const data = Buffer.from(makePktLine(line) + "0000")

    const updates = parseRefUpdates(data)
    expect(updates).toHaveLength(0)
  })
})

describe("extractBranchNames", () => {
  const oldSha = "0000000000000000000000000000000000000000"
  const newSha = "1234567890abcdef1234567890abcdef12345678"

  it("extracts branch name from refs/heads/", () => {
    const updates = [{ oldSha, newSha, refName: "refs/heads/main" }]
    expect(extractBranchNames(updates)).toEqual(["main"])
  })

  it("extracts multiple branch names", () => {
    const updates = [
      { oldSha, newSha, refName: "refs/heads/main" },
      { oldSha, newSha, refName: "refs/heads/feature/foo" },
    ]
    expect(extractBranchNames(updates)).toEqual(["main", "feature/foo"])
  })

  it("ignores tags", () => {
    const updates = [
      { oldSha, newSha, refName: "refs/heads/main" },
      { oldSha, newSha, refName: "refs/tags/v1.0.0" },
    ]
    expect(extractBranchNames(updates)).toEqual(["main"])
  })

  it("ignores other refs", () => {
    const updates = [
      { oldSha, newSha, refName: "refs/heads/main" },
      { oldSha, newSha, refName: "refs/pull/1/head" },
      { oldSha, newSha, refName: "refs/notes/commits" },
    ]
    expect(extractBranchNames(updates)).toEqual(["main"])
  })

  it("deduplicates branch names", () => {
    const updates = [
      { oldSha, newSha, refName: "refs/heads/main" },
      { oldSha, newSha, refName: "refs/heads/main" },
    ]
    expect(extractBranchNames(updates)).toEqual(["main"])
  })

  it("handles nested branch names", () => {
    const updates = [{ oldSha, newSha, refName: "refs/heads/feature/nested/deep" }]
    expect(extractBranchNames(updates)).toEqual(["feature/nested/deep"])
  })
})

describe("extractBranchesFromPack", () => {
  const oldSha = "0000000000000000000000000000000000000000"
  const newSha = "1234567890abcdef1234567890abcdef12345678"

  function makePktLine(content: string): string {
    const length = content.length + 4
    return length.toString(16).padStart(4, "0") + content
  }

  it("parses and extracts branches in one call", () => {
    const line1 = `${oldSha} ${newSha} refs/heads/main\n`
    const line2 = `${oldSha} ${newSha} refs/tags/v1.0.0\n`
    const data = Buffer.from(makePktLine(line1) + makePktLine(line2) + "0000")

    const branches = extractBranchesFromPack(data)
    expect(branches).toEqual(["main"])
  })
})
