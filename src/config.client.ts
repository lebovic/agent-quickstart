import { z } from "zod"

const clientEnvSchema = z.object({
  NEXT_PUBLIC_DEFAULT_GIT_REPO: z.string().default(""),
})

const env = clientEnvSchema.parse({
  NEXT_PUBLIC_DEFAULT_GIT_REPO: process.env.NEXT_PUBLIC_DEFAULT_GIT_REPO,
})

export const clientConfig = {
  defaultGitRepo: env.NEXT_PUBLIC_DEFAULT_GIT_REPO,
}
