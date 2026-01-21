import { type NextRequest, NextResponse } from "next/server"
import { getGitHubAppConfig } from "@/lib/github/app-config"
import { getInstallationOctokit } from "@/lib/github/octokit"
import { badRequest, internalError, serviceUnavailable, unauthorized } from "@/lib/http-errors"
import { log } from "@/lib/logger"
import { getUserProviderContext } from "@/lib/auth/provider-context"
import { proxyToAnthropic } from "@/lib/api/proxy"

/**
 * GET /api/code/repos
 *
 * Returns repositories accessible to the user.
 * - Debug mode: proxies to Anthropic API
 * - Hosted/BYOK mode: uses GitHub App installation
 *
 * TODO: Add pagination for users with >100 repos
 */
export async function GET(request: NextRequest) {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)

  if (userContext.provider.mode === "debug") {
    const { searchParams } = new URL(request.url)
    const queryString = searchParams.toString()
    const path = `api/organizations/${userContext.provider.orgUuid}/code/repos${queryString ? `?${queryString}` : ""}`
    return proxyToAnthropic(request, path, {
      sessionKey: userContext.provider.sessionKey,
      orgUuid: userContext.provider.orgUuid,
    })
  }

  // Hosted/BYOK mode: use local GitHub App integration
  try {
    const appConfig = await getGitHubAppConfig()
    if (!appConfig) {
      return serviceUnavailable("GitHub App not configured")
    }

    const userId = userContext.userId
    const octokit = await getInstallationOctokit(userId)
    if (!octokit) {
      return badRequest("GitHub App not installed")
    }

    // Fetch repositories from GitHub API
    // Note: GitHub API max is 100 per page, need pagination for more
    const { data } = await octokit.apps.listReposAccessibleToInstallation({
      per_page: 100,
    })

    const repos = data.repositories
      .filter((repo) => !repo.archived)
      .map((repo) => ({
        repo: {
          name: repo.name,
          owner: { login: repo.owner.login },
          default_branch: repo.default_branch,
          visibility: repo.private ? "private" : "public",
          archived: repo.archived,
        },
        status: null,
      }))

    return NextResponse.json({ repos })
  } catch (err) {
    log.error({ err: (err as Error).message }, "Failed to fetch repos")
    return internalError(err, { route: "code/repos" })
  }
}
