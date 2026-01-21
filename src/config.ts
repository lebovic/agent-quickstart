import { z } from "zod"

// Server-only config - do not import this file in client components
// Use @/config.client for client-side config

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string(),
  // Required for session JWTs. Generate with: openssl rand -base64 32
  JWT_SECRET: z.string().min(44),
  PROXY_ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_API_URL: z.string().default("https://api.anthropic.com"),
  LOG_LEVEL: z.string().default("info"),
  USE_SELF_HOSTED_SESSIONS: z.string().default("false"),
  ORG_UUID: z.string().default(""),
  // Encryption secret for at-rest encryption (GitHub App credentials, etc.)
  // Generate with: openssl rand -base64 32
  ENCRYPTION_SECRET: z.string().min(44),
  // BetterAuth
  BETTER_AUTH_SECRET: z.string().min(44),
  // Deploy URL for auth redirects, email links, etc. (e.g., https://example.com)
  DEPLOY_URL: z.string().default("http://localhost:3000"),
  // URL for Docker containers to reach the API. Supersedes DEPLOY_URL if set.
  API_URL_FOR_DOCKER_CONTAINERS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  // Domain for sending emails (e.g., auth.example.com)
  EMAIL_FROM_DOMAIN: z.string().optional(),
  // Comma-separated list of allowed WebSocket origins (e.g., "http://localhost:3000,https://myapp.com")
  ALLOWED_WS_ORIGINS: z.string().optional(),
  // Remote Docker host configuration (optional - defaults to local socket)
  DOCKER_HOST: z.string().optional(),
  DOCKER_PORT: z.coerce.number().default(2376),
  DOCKER_CA_CERT_PATH: z.string().optional(),
  DOCKER_CLIENT_CERT_PATH: z.string().optional(),
  DOCKER_CLIENT_KEY_PATH: z.string().optional(),
  // Docker image to use for sessions
  DEFAULT_SESSION_IMAGE: z.string().default("lebovic/agent-quickstart-sessions:latest"),
})

const env = envSchema.parse(process.env)

export const config = {
  isDev: env.NODE_ENV !== "production",
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  encryptionSecret: env.ENCRYPTION_SECRET,
  anthropicApiKey: env.PROXY_ANTHROPIC_API_KEY,
  logLevel: env.LOG_LEVEL,
  anthropicApiUrl: env.ANTHROPIC_API_URL,
  useSelfHostedSessions: env.USE_SELF_HOSTED_SESSIONS === "true",
  orgUuid: env.ORG_UUID,
  deployUrl: env.DEPLOY_URL,
  apiUrlForDockerContainers: env.API_URL_FOR_DOCKER_CONTAINERS ?? env.DEPLOY_URL,
  emailFromDomain: env.EMAIL_FROM_DOMAIN,
  allowedWsOrigins:
    env.ALLOWED_WS_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? [],
  dockerHost: env.DOCKER_HOST
    ? {
        host: env.DOCKER_HOST,
        port: env.DOCKER_PORT,
        caCertPath: env.DOCKER_CA_CERT_PATH,
        clientCertPath: env.DOCKER_CLIENT_CERT_PATH,
        clientKeyPath: env.DOCKER_CLIENT_KEY_PATH,
      }
    : null,
  defaultSessionImage: env.DEFAULT_SESSION_IMAGE,
}
