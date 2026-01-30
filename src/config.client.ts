import { z } from "zod"

const clientEnvSchema = z.object({
  NEXT_PUBLIC_DEFAULT_GIT_REPO: z.string().default(""),
  NEXT_PUBLIC_SHOW_DEBUG_OPTIONS: z.string().default(""),
  NEXT_PUBLIC_GIT_INTEGRATION_MODE: z.enum(["required", "optional", "disabled"]).default("optional"),
})

const env = clientEnvSchema.parse({
  NEXT_PUBLIC_DEFAULT_GIT_REPO: process.env.NEXT_PUBLIC_DEFAULT_GIT_REPO,
  NEXT_PUBLIC_SHOW_DEBUG_OPTIONS: process.env.NEXT_PUBLIC_SHOW_DEBUG_OPTIONS,
  NEXT_PUBLIC_GIT_INTEGRATION_MODE: process.env.NEXT_PUBLIC_GIT_INTEGRATION_MODE,
})

export const clientConfig = {
  defaultGitRepo: env.NEXT_PUBLIC_DEFAULT_GIT_REPO,
  showDebugOptions: env.NEXT_PUBLIC_SHOW_DEBUG_OPTIONS === "true",
  gitIntegrationMode: env.NEXT_PUBLIC_GIT_INTEGRATION_MODE,
}
