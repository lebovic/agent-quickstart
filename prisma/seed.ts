import { PrismaClient } from "@prisma/client"
import { randomUUID } from "crypto"
import { encrypt } from "../src/lib/crypto/encryption"

const prisma = new PrismaClient()

// Default environment ID - matches the hardcoded default in SessionCreator
// env_01BDg2Qjo5LLwN43UrSKNU5x decodes to this UUID
const DEFAULT_ENV_UUID = "65cc9431-b74f-9825-71f7-e0f8482e9b31"

// Default user ID for development (no auth implemented yet)
const DEFAULT_USER_UUID = "00000000-0000-0000-0000-000000000001"

async function seedEnvironment() {
  const existing = await prisma.environment.findUnique({
    where: { id: DEFAULT_ENV_UUID },
  })

  if (existing) {
    console.log("Default environment already exists:", existing.name)
    return
  }

  const config = {
    environment_type: "local",
    cwd: "/home/user",
    environment: {},
  }

  const env = await prisma.environment.create({
    data: {
      id: DEFAULT_ENV_UUID,
      name: "Default",
      kind: "local",
      state: "active",
      userId: DEFAULT_USER_UUID,
      configEnc: encrypt(JSON.stringify(config)),
    },
  })

  console.log("Created default environment:", env.name, "with ID env_01BDg2Qjo5LLwN43UrSKNU5x")
}

async function seedDefaultUser() {
  const existing = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_UUID },
  })

  // Get GitHub installation ID from env if provided
  const githubInstallationId = process.env.GITHUB_INSTALLATION_ID

  if (existing) {
    // Update installation ID if provided and different
    if (githubInstallationId && existing.githubInstallationId !== githubInstallationId) {
      await prisma.user.update({
        where: { id: DEFAULT_USER_UUID },
        data: { githubInstallationId },
      })
      console.log("Updated default user GitHub installation ID:", githubInstallationId)
    } else {
      console.log("Default user already exists")
    }
    return
  }

  await prisma.user.create({
    data: {
      id: DEFAULT_USER_UUID,
      email: "dev@localhost",
      emailVerified: true,
      githubInstallationId: githubInstallationId || null,
    },
  })

  console.log("Created default user with ID:", DEFAULT_USER_UUID)
  if (githubInstallationId) {
    console.log("  GitHub installation ID:", githubInstallationId)
  }
}

async function seedGitHubAppConfig() {
  // Only seed if all required env vars are present
  const appId = process.env.GITHUB_APP_ID
  const appSlug = process.env.GITHUB_APP_SLUG
  const clientId = process.env.GITHUB_APP_CLIENT_ID
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET
  const encryptionSecret = process.env.ENCRYPTION_SECRET

  if (!appId || !appSlug || !clientId || !clientSecret || !privateKey) {
    console.log(
      "Skipping GitHub App config (set GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_PRIVATE_KEY to seed)"
    )
    return
  }

  if (!encryptionSecret || encryptionSecret.length < 32) {
    console.log("Skipping GitHub App config (ENCRYPTION_SECRET must be set and at least 32 characters)")
    return
  }

  const existing = await prisma.gitHubAppConfig.findFirst()

  const data = {
    appId,
    appSlug,
    clientId,
    clientSecretEnc: encrypt(clientSecret),
    privateKeyEnc: encrypt(privateKey),
    webhookSecretEnc: webhookSecret ? encrypt(webhookSecret) : null,
  }

  if (existing) {
    await prisma.gitHubAppConfig.update({
      where: { id: existing.id },
      data,
    })
    console.log("Updated GitHub App config")
  } else {
    await prisma.gitHubAppConfig.create({
      data: {
        id: randomUUID(),
        ...data,
      },
    })
    console.log("Created GitHub App config for app ID:", appId)
  }
}

async function main() {
  // User must be created before environment (foreign key constraint)
  await seedDefaultUser()
  await seedEnvironment()
  await seedGitHubAppConfig()
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
