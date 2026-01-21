import { createAppAuth } from "@octokit/auth-app"
import { log } from "@/lib/logger"

// Cache auth instances by appId (they internally cache tokens)
const authCache = new Map<string, ReturnType<typeof createAppAuth>>()

function getOrCreateAuth(appId: string, privateKey: string): ReturnType<typeof createAppAuth> {
  const cached = authCache.get(appId)
  if (cached) {
    return cached
  }

  const auth = createAppAuth({
    appId,
    privateKey,
  })

  authCache.set(appId, auth)
  return auth
}

/**
 * Gets an installation access token for a GitHub App installation.
 * Tokens are automatically cached and refreshed by @octokit/auth-app.
 */
export async function getInstallationToken(appId: string, privateKey: string, installationId: string): Promise<string> {
  const auth = getOrCreateAuth(appId, privateKey)

  try {
    const result = await auth({
      type: "installation",
      installationId: Number(installationId),
    })

    log.debug({ installationId }, "Got installation token")
    return result.token
  } catch (err) {
    log.error({ installationId, err: (err as Error).message }, "Failed to get installation token")
    throw err
  }
}

/**
 * Clears the auth cache. Useful for testing or when credentials change.
 */
export function clearAuthCache(): void {
  authCache.clear()
}
