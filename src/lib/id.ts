import { v4 as uuidv4 } from "uuid"

const SESSION_PREFIX = "session_"
const ENV_PREFIX = "env_"
const FILE_PREFIX = "file_"

// Base62 alphabet (0-9, A-Z, a-z)
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export function generateUuid(): string {
  return uuidv4()
}

// Anthropic uses 24-char base62 IDs (with leading zeros for padding)
const ID_LENGTH = 24

/**
 * Encode a UUID (128 bits) to base62 string.
 * Produces a 24-character string to match Anthropic's ID format.
 */
function uuidToBase62(uuid: string): string {
  // Remove dashes and convert hex to BigInt
  const hex = uuid.replace(/-/g, "")
  let num = BigInt("0x" + hex)

  if (num === 0n) {
    return "0".repeat(ID_LENGTH)
  }

  let result = ""
  while (num > 0n) {
    result = BASE62_CHARS[Number(num % 62n)] + result
    num = num / 62n
  }

  // Pad to 24 characters to match Anthropic's format
  return result.padStart(ID_LENGTH, "0")
}

/**
 * Decode a base62 string back to UUID format.
 */
function base62ToUuid(encoded: string): string {
  let num = 0n
  for (const char of encoded) {
    const index = BASE62_CHARS.indexOf(char)
    if (index === -1) {
      throw new Error(`Invalid base62 character: ${char}`)
    }
    num = num * 62n + BigInt(index)
  }

  // Convert to hex and pad to 32 characters
  const hex = num.toString(16).padStart(32, "0")

  // Truncate if longer than 32 chars (can happen with 24-char base62 input)
  const truncatedHex = hex.slice(-32)

  // Format as UUID
  return [
    truncatedHex.slice(0, 8),
    truncatedHex.slice(8, 12),
    truncatedHex.slice(12, 16),
    truncatedHex.slice(16, 20),
    truncatedHex.slice(20),
  ].join("-")
}

export function uuidToSessionId(uuid: string): string {
  return SESSION_PREFIX + uuidToBase62(uuid)
}

export function sessionIdToUuid(sessionId: string): string {
  if (!sessionId.startsWith(SESSION_PREFIX)) {
    throw new Error(`Invalid session ID format: ${sessionId}`)
  }
  const encoded = sessionId.slice(SESSION_PREFIX.length)
  return base62ToUuid(encoded)
}

export function uuidToEnvId(uuid: string): string {
  return ENV_PREFIX + uuidToBase62(uuid)
}

export function envIdToUuid(envId: string): string {
  if (!envId.startsWith(ENV_PREFIX)) {
    throw new Error(`Invalid environment ID format: ${envId}`)
  }
  const encoded = envId.slice(ENV_PREFIX.length)
  return base62ToUuid(encoded)
}

export function uuidToFileId(uuid: string): string {
  return FILE_PREFIX + uuidToBase62(uuid)
}

export function fileIdToUuid(fileId: string): string {
  if (!fileId.startsWith(FILE_PREFIX)) {
    throw new Error(`Invalid file ID format: ${fileId}`)
  }
  const encoded = fileId.slice(FILE_PREFIX.length)
  return base62ToUuid(encoded)
}
