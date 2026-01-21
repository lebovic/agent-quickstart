import { type NextRequest, NextResponse } from "next/server"
import { getGitHubAppConfig } from "@/lib/github/app-config"
import { getInstallationOctokit } from "@/lib/github/octokit"
import { badRequest, internalError, serviceUnavailable, unauthorized } from "@/lib/http-errors"
import { log } from "@/lib/logger"
import { getUserProviderContext } from "@/lib/auth/provider-context"
import { proxyToAnthropic } from "@/lib/api/proxy"

type RouteParams = {
  params: Promise<{ owner: string; repo: string }>
}

/**
 * GET /api/code/repos/[owner]/[repo]/branches
 *
 * Returns branches for a specific repository.
 * - Debug mode: proxies to Anthropic API
 * - Hosted/BYOK mode: uses GitHub App installation
 *
 * TODO: Add pagination for repos with >100 branches
 */
export async function GET(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const userContext = await getUserProviderContext()
  if (userContext.type === "unauthenticated") return unauthorized()
  if (userContext.type === "misconfigured") return badRequest(userContext.reason)
  const { owner, repo } = await params

  if (userContext.provider.mode === "debug") {
    const path = `api/organizations/${userContext.provider.orgUuid}/code/repos/${owner}/${repo}/branches`
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

    // Fetch repo info to get default branch
    const { data: repoData } = await octokit.repos.get({ owner, repo })

    // Fetch branches
    const { data: branchesData } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    })

    const branches = branchesData.map((branch) => ({
      name: branch.name,
      is_default: branch.name === repoData.default_branch,
    }))

    return NextResponse.json({ branches })
  } catch (err) {
    log.error({ err: (err as Error).message, owner, repo }, "Failed to fetch branches")
    return internalError(err, { route: "code/repos/branches", owner, repo })
  }
}
