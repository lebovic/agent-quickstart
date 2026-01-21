import { Octokit } from "@octokit/rest"
import { createAppAuth } from "@octokit/auth-app"
import { prisma } from "@/lib/db"
import { getGitHubAppConfig } from "./app-config"

/**
 * Creates an Octokit instance authenticated as the user's GitHub App installation.
 * Returns null if GitHub App is not configured or user hasn't installed it.
 */
export async function getInstallationOctokit(userId: string): Promise<Octokit | null> {
  const appConfig = await getGitHubAppConfig()
  if (!appConfig) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubInstallationId: true },
  })

  if (!user?.githubInstallationId) {
    return null
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: appConfig.appId,
      privateKey: appConfig.privateKey,
      installationId: Number(user.githubInstallationId),
    },
  })
}
