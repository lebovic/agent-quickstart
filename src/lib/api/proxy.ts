import { config } from "@/config"
import { log } from "@/lib/logger"

export type AnthropicCredentials = {
  sessionKey: string
  orgUuid?: string
}

/**
 * Proxy a request to Anthropic API with session key auth.
 * Used for debug mode when routing to Anthropic's API directly.
 */
export async function proxyToAnthropic(request: Request, path: string, credentials: AnthropicCredentials): Promise<Response> {
  const url = `${config.anthropicApiUrl}/${path}`

  const headers: HeadersInit = {
    Cookie: `sessionKey=${credentials.sessionKey}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "ccr-byoc-2025-07-29",
    "Content-Type": request.headers.get("content-type") || "application/json",
  }

  if (credentials.orgUuid) {
    headers["x-organization-uuid"] = credentials.orgUuid
  }

  log.info({ path, method: request.method }, "Proxying to Anthropic API")

  const response = await fetch(url, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    // @ts-expect-error - duplex is needed for streaming request body
    duplex: "half",
  })

  log.info({ path, method: request.method, status: response.status }, "Anthropic API response")

  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
  })
}
