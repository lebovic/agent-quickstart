import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getGitHubAppConfig } from "@/lib/github/app-config"
import { internalError, serviceUnavailable, unauthorized } from "@/lib/http-errors"
import { log } from "@/lib/logger"
import { getSession } from "@/lib/auth"

/**
 * GET /api/github/installation-url
 *
 * Returns the GitHub App installation URL and whether the user has already installed.
 */
export async function GET(_request: NextRequest) {
  const session = await getSession()
  if (!session?.user) return unauthorized()

  try {
    const appConfig = await getGitHubAppConfig()

    if (!appConfig) {
      log.warn("GitHub App not configured")
      return serviceUnavailable("GitHub App not configured")
    }

    const userId = session.user.id

    // Check if user has installation
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubInstallationId: true },
    })

    const installed = Boolean(user?.githubInstallationId)
    const url = `https://github.com/apps/${appConfig.appSlug}/installations/new`

    return NextResponse.json({ url, installed })
  } catch (err) {
    return internalError(err, { route: "github/installation-url" })
  }
}
