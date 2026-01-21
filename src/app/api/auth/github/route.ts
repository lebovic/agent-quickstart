import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { cookies } from "next/headers"
import { getWebFlowAuthorizationUrl } from "@octokit/oauth-methods"
import { getGitHubAppConfig } from "@/lib/github/app-config"
import { log } from "@/lib/logger"
import { config } from "@/config"

const STATE_COOKIE = "github_oauth_state"
const STATE_MAX_AGE = 600

export async function GET(): Promise<Response> {
  const appConfig = await getGitHubAppConfig()

  if (!appConfig) {
    log.warn("GitHub OAuth: App not configured")
    return NextResponse.redirect(`${config.deployUrl}/?error=github_not_configured`)
  }

  const state = randomBytes(32).toString("hex")

  const { url } = getWebFlowAuthorizationUrl({
    clientType: "github-app",
    clientId: appConfig.clientId,
    redirectUrl: `${config.deployUrl}/api/auth/github/callback`,
    state,
  })

  const cookieStore = await cookies()
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_MAX_AGE,
    path: "/",
  })

  log.debug("GitHub OAuth: redirecting to authorization")

  return NextResponse.redirect(url)
}
