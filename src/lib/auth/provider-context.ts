import { type Provider } from "@prisma/client"
import { headers } from "next/headers"
import { prisma } from "@/lib/db"
import { auth } from "./auth"
import { decrypt } from "@/lib/crypto/encryption"
import { log } from "@/lib/logger"

export type ProviderContext = { mode: "hosted" } | { mode: "byok"; apiKey: string } | { mode: "debug"; sessionKey: string; orgUuid: string }

export type UserProviderContext =
  | { type: "authenticated"; userId: string; provider: ProviderContext }
  | { type: "unauthenticated" }
  | { type: "misconfigured"; reason: string }

/**
 * Gets the current user's provider context from the database.
 * Returns authentication state and the user's configured provider mode with decrypted credentials.
 *
 * - hosted: Uses server's Anthropic API key
 * - byok: Uses user's own Anthropic API key
 * - debug: Proxies to Anthropic API using user's session key + org UUID
 */
export async function getUserProviderContext(): Promise<UserProviderContext> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return { type: "unauthenticated" }
  }

  const userId = session.user.id

  // Fetch user's provider settings from database
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      provider: true,
      anthropicApiKeyEnc: true,
      anthropicSessionKeyEnc: true,
      anthropicOrgUuid: true,
    },
  })

  if (!user) {
    log.warn({ userId }, "User not found in database during provider context lookup")
    return { type: "unauthenticated" }
  }

  const result = resolveProviderContext(user)

  if (result.type === "error") {
    return { type: "misconfigured", reason: result.reason }
  }

  return { type: "authenticated", userId, provider: result.provider }
}

type ResolveResult = { type: "success"; provider: ProviderContext } | { type: "error"; reason: string }

/**
 * Resolves the provider context from user settings.
 * Returns an error if required credentials are missing.
 */
function resolveProviderContext(user: {
  provider: Provider
  anthropicApiKeyEnc: string | null
  anthropicSessionKeyEnc: string | null
  anthropicOrgUuid: string | null
}): ResolveResult {
  switch (user.provider) {
    case "byok": {
      if (!user.anthropicApiKeyEnc) {
        return { type: "error", reason: "BYOK mode requires an Anthropic API key" }
      }
      try {
        const apiKey = decrypt(user.anthropicApiKeyEnc)
        return { type: "success", provider: { mode: "byok", apiKey } }
      } catch (error) {
        log.error({ error }, "Failed to decrypt BYOK API key")
        return { type: "error", reason: "Failed to decrypt API key" }
      }
    }

    case "debug": {
      if (!user.anthropicSessionKeyEnc) {
        return { type: "error", reason: "Debug mode requires a session key" }
      }
      if (!user.anthropicOrgUuid) {
        return { type: "error", reason: "Debug mode requires an organization UUID" }
      }
      try {
        const sessionKey = decrypt(user.anthropicSessionKeyEnc)
        return { type: "success", provider: { mode: "debug", sessionKey, orgUuid: user.anthropicOrgUuid } }
      } catch (error) {
        log.error({ error }, "Failed to decrypt debug session key")
        return { type: "error", reason: "Failed to decrypt session key" }
      }
    }

    case "hosted":
    default:
      return { type: "success", provider: { mode: "hosted" } }
  }
}
