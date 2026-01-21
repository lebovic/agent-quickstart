/**
 * Git pack-line protocol parser for extracting refs from push operations.
 *
 * Git Smart HTTP protocol uses pkt-line format:
 * - Each line prefixed with 4-digit hex length (includes the 4 bytes)
 * - "0000" is a flush packet (delimiter)
 * - For receive-pack, format is: <old-sha> <new-sha> <refname>[\0<capabilities>]
 *
 * Reference: https://git-scm.com/docs/pack-protocol
 */

export type RefUpdate = {
  oldSha: string
  newSha: string
  refName: string
}

/**
 * Parses pkt-line format data and extracts ref updates.
 * Used to determine which branches a push operation targets.
 */
export function parseRefUpdates(data: Buffer): RefUpdate[] {
  const updates: RefUpdate[] = []
  let offset = 0

  while (offset < data.length) {
    // Read 4-byte hex length
    if (offset + 4 > data.length) {
      break
    }

    const lengthHex = data.subarray(offset, offset + 4).toString("ascii")

    // "0000" is flush packet - end of ref updates
    if (lengthHex === "0000") {
      break
    }

    const length = parseInt(lengthHex, 16)
    if (isNaN(length) || length < 4) {
      break
    }

    // Length includes the 4-byte header
    const lineEnd = offset + length
    if (lineEnd > data.length) {
      break
    }

    // Extract line content (skip the 4-byte length prefix)
    const lineContent = data.subarray(offset + 4, lineEnd).toString("utf8")

    // Parse ref update: <old-sha> <new-sha> <refname>[\0<capabilities>]
    const refUpdate = parseRefUpdateLine(lineContent)
    if (refUpdate) {
      updates.push(refUpdate)
    }

    offset = lineEnd
  }

  return updates
}

/**
 * Parses a single ref update line.
 * Format: <old-sha> <new-sha> <refname>[\0<capabilities>]
 */
function parseRefUpdateLine(line: string): RefUpdate | null {
  // Remove capabilities (everything after null byte)
  const nullIndex = line.indexOf("\0")
  const refPart = nullIndex >= 0 ? line.slice(0, nullIndex) : line

  // Remove trailing newline if present
  const trimmed = refPart.replace(/\n$/, "")

  // Split into parts: old-sha, new-sha, refname
  const parts = trimmed.split(" ")
  if (parts.length < 3) {
    return null
  }

  const [oldSha, newSha, refName] = parts

  // Validate SHA format (40 hex chars)
  const shaRegex = /^[0-9a-f]{40}$/
  if (!shaRegex.test(oldSha) || !shaRegex.test(newSha)) {
    return null
  }

  // Validate ref name starts with refs/
  if (!refName.startsWith("refs/")) {
    return null
  }

  return { oldSha, newSha, refName }
}

/**
 * Extracts branch names from ref updates.
 * Only returns branches (refs/heads/*), not tags or other refs.
 */
export function extractBranchNames(updates: RefUpdate[]): string[] {
  const branches: string[] = []

  for (const update of updates) {
    // refs/heads/branch-name -> branch-name
    if (update.refName.startsWith("refs/heads/")) {
      const branch = update.refName.slice("refs/heads/".length)
      if (branch && !branches.includes(branch)) {
        branches.push(branch)
      }
    }
  }

  return branches
}

/**
 * Convenience function to parse buffer and extract branch names in one call.
 */
export function extractBranchesFromPack(data: Buffer): string[] {
  const updates = parseRefUpdates(data)
  return extractBranchNames(updates)
}
