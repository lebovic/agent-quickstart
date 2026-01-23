import type {
  Session,
  CreateSessionRequest,
  EventsResponse,
  Environment,
  EnvironmentsResponse,
  SessionsResponse,
  CreateEnvironmentRequest,
  UpdateEnvironmentRequest,
} from "@/lib/types/anthropic_session"

// Use our proxy endpoint - handles auth and forwards to Anthropic API
const API_BASE = "/api/anthropic"

type FetchOptions = RequestInit & {
  skipBetaHeader?: boolean
}

export async function fetchAnthropicAPI<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const { skipBetaHeader, ...fetchOptions } = options

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(!skipBetaHeader && { "anthropic-beta": "ccr-byoc-2025-07-29" }),
    ...fetchOptions.headers,
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

  return response.json()
}

// Session API functions
export async function listSessions() {
  return fetchAnthropicAPI<SessionsResponse>("/v1/sessions")
}

export async function getSession(sessionId: string) {
  return fetchAnthropicAPI<Session>(`/v1/sessions/${sessionId}`)
}

export async function createSession(data: CreateSessionRequest) {
  return fetchAnthropicAPI<Session>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function getSessionEvents(sessionId: string) {
  return fetchAnthropicAPI<EventsResponse>(`/v1/sessions/${sessionId}/events`)
}

export async function archiveSession(sessionId: string) {
  return fetchAnthropicAPI<Session>(`/v1/sessions/${sessionId}/archive`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

// Environment API functions - use our routes which handle self-hosted vs proxy
const ENV_API_BASE = "/api/v1/environment_providers"

export async function getEnvironment(environmentId: string) {
  const response = await fetch(`${ENV_API_BASE}/${environmentId}`, {
    headers: { "Content-Type": "application/json" },
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`)
  }
  return response.json() as Promise<Environment>
}

export async function listEnvironments() {
  const response = await fetch(ENV_API_BASE, {
    headers: { "Content-Type": "application/json" },
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`)
  }
  return response.json() as Promise<EnvironmentsResponse>
}

export async function createEnvironment(data: CreateEnvironmentRequest) {
  const kind = data.kind || "default"
  const response = await fetch(`${ENV_API_BASE}/${kind}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`)
  }
  return response.json() as Promise<Environment>
}

export async function updateEnvironment(envId: string, data: UpdateEnvironmentRequest) {
  const response = await fetch(`${ENV_API_BASE}/${envId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`)
  }
  return response.json() as Promise<Environment>
}
