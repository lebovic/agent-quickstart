import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "crypto"

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32 // 256 bits
const SALT_LENGTH = 16
const IV_LENGTH = 12 // GCM standard
const AUTH_TAG_LENGTH = 16

// Current encryption version - increment when changing encryption scheme
const CURRENT_VERSION = 1

// scrypt parameters (N=16384, r=8, p=1 is ~100ms on modern hardware)
// Increase N for higher security at cost of performance
const SCRYPT_OPTIONS = {
  N: 16384, // CPU/memory cost parameter (must be power of 2)
  r: 8, // Block size
  p: 1, // Parallelization parameter
}

function getEncryptionSecret(version: number = CURRENT_VERSION): string {
  // Support versioned secrets for key rotation: ENCRYPTION_SECRET_V1, ENCRYPTION_SECRET_V2, etc.
  // Falls back to ENCRYPTION_SECRET for v1 if versioned var not set
  const versionedKey = `ENCRYPTION_SECRET_V${version}`
  const secret = process.env[versionedKey] ?? (version === 1 ? process.env.ENCRYPTION_SECRET : undefined)

  if (!secret || secret.length < 32) {
    throw new Error(`${versionedKey} (or ENCRYPTION_SECRET for v1) must be at least 32 characters`)
  }
  return secret
}

function deriveKey(salt: Buffer, version: number): Buffer {
  const secret = getEncryptionSecret(version)
  return scryptSync(secret, salt, KEY_LENGTH, SCRYPT_OPTIONS)
}

/**
 * Encrypts plaintext using AES-256-GCM with scrypt key derivation.
 * Returns base64-encoded ciphertext in format: version(1) || salt(16) || iv(12) || authTag(16) || ciphertext
 */
export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(salt, CURRENT_VERSION)
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Concatenate: version || salt || iv || authTag || ciphertext
  const versionBuf = Buffer.from([CURRENT_VERSION])
  const result = Buffer.concat([versionBuf, salt, iv, authTag, encrypted])
  return result.toString("base64")
}

/**
 * Decrypts base64-encoded ciphertext encrypted with encrypt().
 * Supports multiple key versions for key rotation.
 */
export function decrypt(ciphertext: string): string {
  const data = Buffer.from(ciphertext, "base64")

  const minLength = 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1
  if (data.length < minLength) {
    throw new Error("Invalid ciphertext: too short")
  }

  const version = data[0]
  if (version < 1 || version > CURRENT_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`)
  }

  const salt = data.subarray(1, 1 + SALT_LENGTH)
  const iv = data.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH)
  const authTag = data.subarray(1 + SALT_LENGTH + IV_LENGTH, 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.subarray(1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)

  const key = deriveKey(salt, version)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

  return decrypted.toString("utf8")
}

/**
 * Re-encrypts ciphertext with the current key version.
 * Use this during key rotation to migrate data to the new key.
 */
export function reencrypt(ciphertext: string): string {
  const plaintext = decrypt(ciphertext)
  return encrypt(plaintext)
}

/**
 * Returns the version of the encryption key used for a ciphertext.
 * Useful for identifying data that needs re-encryption during rotation.
 */
export function getEncryptionVersion(ciphertext: string): number {
  const data = Buffer.from(ciphertext, "base64")
  if (data.length < 1) {
    throw new Error("Invalid ciphertext: empty")
  }
  return data[0]
}
