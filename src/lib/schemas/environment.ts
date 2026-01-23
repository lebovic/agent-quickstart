import { z } from "zod"
import type { Environment as PrismaEnvironment } from "@prisma/client"
import { uuidToEnvId } from "@/lib/id"
import { encrypt, decrypt } from "@/lib/crypto/encryption"
import { log } from "@/lib/logger"

export const EnvironmentKind = z.enum(["docker", "modal"])

export const EnvironmentState = z.enum(["active", "inactive"])

export const NetworkConfig = z.object({
  allow_outbound: z.boolean().optional(),
  allow_default_hosts: z.boolean().optional(),
  allowed_hosts: z.array(z.string()).optional(),
})

export const Language = z.object({
  name: z.string(),
  version: z.string(),
})

export const EnvironmentConfig = z.object({
  environment_type: z.string().optional(),
  cwd: z.string().optional(),
  init_script: z.string().nullable().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  environment_variables: z.record(z.string(), z.string()).optional(),
  network_config: NetworkConfig.optional(),
  languages: z.array(Language).optional(),
})

export const Environment = z.object({
  kind: EnvironmentKind,
  environment_id: z.string(),
  name: z.string(),
  created_at: z.string(),
  state: EnvironmentState,
  config: EnvironmentConfig.nullable(),
})

export const CreateEnvironmentRequest = z.object({
  name: z.string().min(1),
  kind: EnvironmentKind.optional(),
  description: z.string().optional(),
  config: EnvironmentConfig.optional(),
})

export const UpdateEnvironmentRequest = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  config: EnvironmentConfig.optional(),
})

export type EnvironmentKind = z.infer<typeof EnvironmentKind>
export type EnvironmentState = z.infer<typeof EnvironmentState>
export type NetworkConfig = z.infer<typeof NetworkConfig>
export type Language = z.infer<typeof Language>
export type EnvironmentConfig = z.infer<typeof EnvironmentConfig>
export type Environment = z.infer<typeof Environment>
export type CreateEnvironmentRequest = z.infer<typeof CreateEnvironmentRequest>
export type UpdateEnvironmentRequest = z.infer<typeof UpdateEnvironmentRequest>

/**
 * Encrypts environment config for storage.
 * Returns encrypted string or null if no config provided.
 */
export function encryptConfig(config: EnvironmentConfig | undefined | null): string | null {
  if (!config) return null

  try {
    const json = JSON.stringify(config)
    return encrypt(json)
  } catch (err) {
    log.error({ err }, "Failed to encrypt environment config")
    throw new Error("Failed to encrypt environment config")
  }
}

/**
 * Decrypts environment config from storage.
 * Returns null if config is null/undefined or decryption fails.
 */
export function decryptConfig(encryptedConfig: unknown): EnvironmentConfig | null {
  if (!encryptedConfig) return null

  // Handle case where config is already an object (legacy unencrypted data)
  if (typeof encryptedConfig === "object") {
    try {
      return EnvironmentConfig.parse(encryptedConfig)
    } catch {
      log.warn("Legacy config failed validation, returning null")
      return null
    }
  }

  if (typeof encryptedConfig !== "string") {
    log.warn({ type: typeof encryptedConfig }, "Unexpected config type")
    return null
  }

  try {
    const json = decrypt(encryptedConfig)
    const parsed = JSON.parse(json)
    return EnvironmentConfig.parse(parsed)
  } catch (err) {
    log.error({ err }, "Failed to decrypt environment config")
    return null
  }
}

export function toApiEnvironment(env: PrismaEnvironment, includeConfig: boolean = true): Environment {
  return {
    kind: EnvironmentKind.parse(env.kind),
    environment_id: uuidToEnvId(env.id),
    name: env.name,
    created_at: env.createdAt.toISOString(),
    state: EnvironmentState.parse(env.state),
    config: includeConfig ? decryptConfig(env.configEnc) : null,
  }
}
