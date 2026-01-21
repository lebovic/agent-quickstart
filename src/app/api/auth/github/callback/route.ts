import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { exchangeWebFlowCode } from "@octokit/oauth-methods"
import { Octokit } from "@octokit/rest"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { getGitHubAppConfig } from "@/lib/github/app-config"
import { getSession } from "@/lib/auth"
import { config } from "@/config"

const STATE_COOKIE = "github_oauth_state"

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const error = request.nextUrl.searchParams.get("error")
  const installationId = request.nextUrl.searchParams.get("installation_id")
  const setupAction = request.nextUrl.searchParams.get("setup_action")

  // GitHub App installation callback - redirect through OAuth to verify ownership
  if (installationId && setupAction) {
    log.info({ installationId, setupAction }, "GitHub App installed, redirecting to OAuth")
    return NextResponse.redirect(`${config.deployUrl}/api/auth/github`)
  }

  if (error) {
    log.warn({ error }, "GitHub OAuth: user denied authorization")
    return NextResponse.redirect(`${config.deployUrl}/?error=github_denied`)
  }

  if (!code || !state) {
    log.warn("GitHub OAuth callback: missing code or state")
    return NextResponse.redirect(`${config.deployUrl}/?error=invalid_callback`)
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get(STATE_COOKIE)?.value
  cookieStore.delete(STATE_COOKIE)

  if (!storedState || storedState !== state) {
    log.warn("GitHub OAuth callback: state mismatch")
    return NextResponse.redirect(`${config.deployUrl}/?error=invalid_state`)
  }

  const appConfig = await getGitHubAppConfig()
  if (!appConfig) {
    log.error("GitHub OAuth callback: App not configured")
    return NextResponse.redirect(`${config.deployUrl}/?error=github_not_configured`)
  }

  try {
    const { authentication } = await exchangeWebFlowCode({
      clientType: "github-app",
      clientId: appConfig.clientId,
      clientSecret: appConfig.clientSecret,
      code,
    })

    log.debug("GitHub OAuth: token exchanged successfully")

    const octokit = new Octokit({ auth: authentication.token })
    const { data } = await octokit.apps.listInstallationsForAuthenticatedUser()

    if (data.installations.length === 0) {
      log.warn("GitHub OAuth: user has no installations")
      return NextResponse.redirect(new URL(`https://github.com/apps/${appConfig.appSlug}/installations/new`))
    }

    const installation = data.installations[0]
    const installationId = String(installation.id)
    const accountName = installation.account && "login" in installation.account ? installation.account.login : undefined

    log.info({ installationId, account: accountName }, "GitHub OAuth: found installation")

    const session = await getSession()
    if (!session?.user) {
      log.warn("GitHub OAuth callback: user not authenticated")
      return NextResponse.redirect(`${config.deployUrl}/?error=not_authenticated`)
    }

    const userId = session.user.id

    await prisma.user.update({
      where: { id: userId },
      data: { githubInstallationId: installationId },
    })

    log.info({ userId, installationId }, "Stored GitHub installation ID")

    return NextResponse.redirect(`${config.deployUrl}/?github=connected`)
  } catch (err) {
    log.error({ err: (err as Error).message }, "GitHub OAuth callback failed")
    return NextResponse.redirect(`${config.deployUrl}/?error=github_auth_failed`)
  }
}
