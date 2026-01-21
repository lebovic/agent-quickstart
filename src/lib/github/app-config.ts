import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/crypto/encryption"
import { log } from "@/lib/logger"
import { randomUUID } from "crypto"

export type GitHubAppConfig = {
  appId: string
  appSlug: string
  clientId: string
  clientSecret: string
  privateKey: string
  webhookSecret?: string
}

/**
 * Gets the org-level GitHub App config (singleton).
 * Returns null if not configured.
 */
export async function getGitHubAppConfig(): Promise<GitHubAppConfig | null> {
  const config = await prisma.gitHubAppConfig.findFirst()

  if (!config) {
    return null
  }

  try {
    return {
      appId: config.appId,
      appSlug: config.appSlug,
      clientId: config.clientId,
      clientSecret: decrypt(config.clientSecretEnc),
      privateKey: decrypt(config.privateKeyEnc),
      webhookSecret: config.webhookSecretEnc ? decrypt(config.webhookSecretEnc) : undefined,
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, "Failed to decrypt GitHub App config")
    throw new Error("Failed to decrypt GitHub App config")
  }
}

/**
 * Sets or updates the org-level GitHub App config.
 * Encrypts sensitive fields before storing.
 */
export async function setGitHubAppConfig(config: GitHubAppConfig): Promise<void> {
  const existing = await prisma.gitHubAppConfig.findFirst()

  const data = {
    appId: config.appId,
    appSlug: config.appSlug,
    clientId: config.clientId,
    clientSecretEnc: encrypt(config.clientSecret),
    privateKeyEnc: encrypt(config.privateKey),
    webhookSecretEnc: config.webhookSecret ? encrypt(config.webhookSecret) : null,
  }

  if (existing) {
    await prisma.gitHubAppConfig.update({
      where: { id: existing.id },
      data,
    })
    log.info("Updated GitHub App config")
  } else {
    await prisma.gitHubAppConfig.create({
      data: {
        id: randomUUID(),
        ...data,
      },
    })
    log.info("Created GitHub App config")
  }
}

/**
 * Deletes the org-level GitHub App config.
 */
export async function deleteGitHubAppConfig(): Promise<void> {
  await prisma.gitHubAppConfig.deleteMany()
  log.info("Deleted GitHub App config")
}
