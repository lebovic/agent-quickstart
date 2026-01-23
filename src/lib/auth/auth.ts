import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { organization, magicLink } from "better-auth/plugins"
import { nextCookies } from "better-auth/next-js"
import { Resend } from "resend"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { encrypt } from "@/lib/crypto/encryption"
import { config } from "@/config"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: config.deployUrl,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  trustedOrigins: [config.deployUrl],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "database",
    customRules: {
      "/sign-in/*": {
        window: 60,
        max: 10,
      },
      "/magic-link/*": {
        window: 300,
        max: 5,
      },
    },
  },
  advanced: {
    cookiePrefix: "agent-quickstart",
    useSecureCookies: true,
    database: {
      generateId: () => randomUUID(),
    },
  },
  user: {
    modelName: "User",
    fields: {
      id: "id",
      name: "name",
      email: "email",
      emailVerified: "emailVerified",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  },
  session: {
    modelName: "AuthSession",
    fields: {
      userId: "userId",
      expiresAt: "expiresAt",
      token: "tokenEnc",
      ipAddress: "ipAddress",
      userAgent: "userAgent",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  },
  account: {
    modelName: "Account",
    fields: {
      userId: "userId",
      accountId: "accountId",
      providerId: "providerId",
      accessToken: "accessTokenEnc",
      refreshToken: "refreshTokenEnc",
      accessTokenExpiresAt: "accessTokenExpiresAt",
      refreshTokenExpiresAt: "refreshTokenExpiresAt",
      scope: "scope",
      idToken: "idTokenEnc",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  },
  verification: {
    modelName: "Verification",
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (resend) {
          await resend.emails.send({
            from: `Agent Quickstart <noreply@${config.emailFromDomain}>`,
            to: email,
            subject: "Sign in to your agent quickstart",
            html: `<p>Here's your sign-in link for your agent quickstart: <a href="${url}">${url}</a></p>`,
          })
          log.info({ email }, "Magic link sent")
        } else {
          log.info({ email, url }, "Magic link (dev mode)")
        }
      },
    }),
    organization({
      schema: {
        organization: {
          modelName: "Organization",
          fields: {
            id: "id",
            name: "name",
            slug: "slug",
            logo: "logo",
            metadata: "metadata",
            createdAt: "createdAt",
            updatedAt: "updatedAt",
          },
        },
        member: {
          modelName: "OrganizationUser",
          fields: {
            id: "id",
            userId: "userId",
            organizationId: "organizationId",
            role: "role",
            createdAt: "createdAt",
            updatedAt: "updatedAt",
          },
        },
      },
    }),
    nextCookies(),
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const defaultEnvConfig = {
            environment_type: "local",
            cwd: "/home/user",
            environment: {},
          }

          await Promise.all([
            prisma.organization.create({
              data: {
                name: "",
                slug: user.id,
                users: {
                  create: {
                    userId: user.id,
                    role: "owner",
                  },
                },
              },
            }),
            prisma.environment.create({
              data: {
                id: randomUUID(),
                name: "Default",
                kind: config.defaultExecutor,
                state: "active",
                userId: user.id,
                configEnc: encrypt(JSON.stringify(defaultEnvConfig)),
              },
            }),
          ])

          log.info({ userId: user.id }, "Created default organization and environment for new user")
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
