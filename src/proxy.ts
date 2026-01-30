import { type NextRequest, NextResponse } from "next/server"
import { config as appConfig } from "@/config"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { auth } from "@/lib/auth/auth"

const GIT_ROUTE_PREFIXES = ["/api/github", "/api/auth/github", "/api/code/repos", "/api/git-proxy"]

// Basic rate limiting for a somewhat self-contained, deployable project.
// Hits Postgres on every request. Suboptimal, but tenable to start
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 100

const RATE_LIMIT_CONFIGS: Record<string, { window: number; max: number }> = {
  "/api/v1/sessions": { window: 60_000, max: 30 },
  "/api/v1/environment_providers": { window: 60_000, max: 20 },
  "/api/auth/github": { window: 60_000, max: 10 },
}

const AUTH_EXCLUDED_PATHS = ["/login", "/legal", "/api/auth", "/api/v1/session_ingress", "/api/github-proxy"]
const RATE_LIMIT_EXCLUDED_PATHS = ["/api/auth/"] // BetterAuth handles its own rate limiting

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return request.headers.get("x-real-ip")
}

function getRateLimitConfig(path: string): { window: number; max: number } {
  for (const [pattern, config] of Object.entries(RATE_LIMIT_CONFIGS)) {
    if (path.startsWith(pattern)) return config
  }
  return { window: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }
}

async function checkRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl

  if (RATE_LIMIT_EXCLUDED_PATHS.some((p) => pathname.startsWith(p))) {
    return null
  }

  const ip = getClientIp(request)
  if (!ip) return null

  const key = `${ip}:${pathname}`
  const now = Date.now()
  const config = getRateLimitConfig(pathname)

  try {
    const record = await prisma.rateLimit.findUnique({ where: { id: key } })

    if (!record) {
      prisma.rateLimit
        .create({ data: { id: key, key, count: 1, lastRequest: BigInt(now) } })
        .catch((err) => log.error({ err, key }, "Rate limit create failed"))
      return null
    }

    const windowStart = Number(record.lastRequest)
    const windowExpired = now - windowStart > config.window

    if (windowExpired) {
      // Fixed window: reset count and start new window
      prisma.rateLimit
        .update({ where: { id: key }, data: { count: 1, lastRequest: BigInt(now) } })
        .catch((err) => log.error({ err, key }, "Rate limit update failed"))
      return null
    }

    if (record.count >= config.max) {
      const retryAfter = Math.ceil((config.window - (now - windowStart)) / 1000)
      log.warn({ ip, path: pathname, count: record.count }, "Rate limit exceeded")
      return NextResponse.json(
        { type: "error", error: { type: "rate_limit_error", message: "Too many requests" } },
        { status: 429, headers: { "X-Retry-After": String(retryAfter) } }
      )
    }

    prisma.rateLimit
      .update({ where: { id: key }, data: { count: record.count + 1 } })
      .catch((err) => log.error({ err, key }, "Rate limit update failed"))

    return null
  } catch (err) {
    log.error({ err, key }, "Rate limit check failed")
    return null
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Block git routes when git integration is disabled
  if (appConfig.gitIntegrationMode === "disabled") {
    if (GIT_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      return NextResponse.json(
        { type: "error", error: { type: "not_found_error", message: "Git integration is disabled" } },
        { status: 404 }
      )
    }
  }

  // Rate limit API routes
  if (pathname.startsWith("/api")) {
    const rateLimitResponse = await checkRateLimit(request)
    if (rateLimitResponse) return rateLimitResponse
  }

  // Auth redirect for protected routes
  if (AUTH_EXCLUDED_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session && !pathname.startsWith("/api")) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
