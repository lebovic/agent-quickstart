import { z } from "zod"
import { Provider as PrismaProvider } from "@prisma/client"

export const Provider = z.nativeEnum(PrismaProvider)

export const UpdateSettingsRequest = z.object({
  provider: Provider.optional(),
  anthropicApiKey: z.string().optional(),
  anthropicSessionKey: z.string().optional(),
  anthropicOrgUuid: z.string().optional(),
})

export const SettingsResponse = z.object({
  provider: Provider,
  anthropicApiKeyMasked: z.string().nullable(),
  anthropicSessionKeyMasked: z.string().nullable(),
  anthropicOrgUuid: z.string().nullable(),
})

export type Provider = z.infer<typeof Provider>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>
export type SettingsResponse = z.infer<typeof SettingsResponse>

/**
 * Masks an Anthropic key for safe display.
 * Works for API keys (sk-ant-api03-...) and session keys (sk-ant-sid01-...)
 */
export function maskAnthropicKey(key: string | null): string | null {
  if (!key) return null
  return `${key.slice(0, 12)}...${key.slice(-4)}`
}
