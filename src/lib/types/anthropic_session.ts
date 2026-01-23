import type {
  Message,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ImageBlockParam,
  TextBlockParam,
  Base64ImageSource,
  Model,
} from "@anthropic-ai/sdk/resources/messages/messages"

// Re-export SDK types for convenience
export type { Message, ContentBlock, TextBlock, ThinkingBlock, ToolUseBlock, ImageBlockParam, TextBlockParam, Base64ImageSource, Model }

// Common derived types
export type MessageContent = string | (ImageBlockParam | TextBlockParam)[]
export type ConnectionState = "disconnected" | "connecting" | "connected" | "error"

// ============================================================================
// Session Types (REST API)
// ============================================================================

export type Session = {
  id: string
  title: string
  environment_id: string
  session_status: "running" | "idle" | "paused" | "completed" | "failed" | "archived"
  session_context: SessionContext
  created_at: string
  updated_at: string
  type: "internal_session"
}

export type SessionContext = {
  sources: { type: "git_repository"; url: string }[]
  outcomes: { type: "git_repository"; git_info: { type: "github"; repo: string; branches: string[] } }[]
  model: string
  allowed_tools: string[]
  disallowed_tools: string[]
  cwd: string
}

export type CreateSessionRequest = {
  title: string
  environment_id: string
  session_context: {
    sources: { type: "git_repository"; url: string }[]
    outcomes?: { type: "git_repository"; git_info: { type: "github"; repo: string; branches: string[] } }[]
    model: string
  }
}

export type EnvironmentConfig = {
  environment_type: "anthropic" | "local"
  sub_type?: "ccr"
  cwd: string
  init_script: string | null
  environment: Record<string, string>
  languages: { name: string; version: string }[]
  network_config: {
    allowed_hosts: string[]
    allow_default_hosts: boolean
  }
}

export type Environment = {
  kind: "anthropic_cloud" | "docker" | "modal"
  environment_id: string
  name: string
  created_at: string
  state: "active" | "inactive"
  config: EnvironmentConfig | null
}

export type CreateEnvironmentRequest = {
  name: string
  kind?: "anthropic_cloud" | "docker" | "modal"
  description: string
  config: Omit<EnvironmentConfig, "sub_type">
}

export type UpdateEnvironmentRequest = {
  name: string
  description: string
  config: EnvironmentConfig
}

// ============================================================================
// WebSocket Outbound Messages (client → server)
// ============================================================================

export type ControlSubtype = "initialize" | "interrupt"

export type OutboundUserMessage = {
  type: "user"
  uuid: string
  session_id: string
  parent_tool_use_id: null
  message: { role: "user"; content: MessageContent }
}

export type OutboundMessage = { type: "control_request"; request_id: string; request: { subtype: ControlSubtype } } | OutboundUserMessage

// ============================================================================
// WebSocket Inbound Events (server → client)
// ============================================================================

export type SessionEvent =
  | ControlResponseEvent
  | EnvManagerLogEvent
  | SystemInitEvent
  | UserEvent
  | AssistantEvent
  | ToolProgressEvent
  | ResultEvent
  | KeepAliveEvent

// Control response (don't render)
export type ControlResponseEvent = {
  type: "control_response"
  response: {
    subtype: "success" | "error"
    request_id: string
    error?: string
  }
}

// Environment logs (don't render)
export type EnvManagerLogEvent = {
  type: "env_manager_log"
  uuid: string
  data: {
    content: string
    level: "debug" | "info" | "warn" | "error"
    category: string
    timestamp: string
    extra: Record<string, unknown>
  }
}

// System init (don't render, but useful for state)
export type SystemInitEvent = {
  type: "system"
  subtype: "init"
  uuid: string
  session_id: string
  cwd: string
  model: string
  tools: string[]
  agents: string[]
  skills: string[]
  slash_commands: string[]
  mcp_servers: string[]
  plugins: string[]
  claude_code_version: string
  apiKeySource: string
  output_style: string
  permissionMode: string
}

// User message OR tool result
export type UserEvent = {
  type: "user"
  uuid: string
  session_id: string
  isReplay?: boolean
  parent_tool_use_id?: string | null
  message: {
    role: "user"
    content: string | (ImageBlockParam | TextBlockParam)[] | ToolResultBlock[]
  }
}

// Tool result block (inside user event content array)
// Content can be string or array of content blocks per SDK ToolResultBlockParam
export type ToolResultBlock = {
  type: "tool_result"
  tool_use_id: string
  content: string | (TextBlockParam | ImageBlockParam)[]
  is_error?: boolean
}

// Assistant response - uses SDK Message type
export type AssistantEvent = {
  type: "assistant"
  uuid: string
  session_id: string
  parent_tool_use_id?: string | null
  message: Message
}

// Tool progress (show spinner/elapsed time)
export type ToolProgressEvent = {
  type: "tool_progress"
  parent_tool_use_id: string
  tool_name: string
  elapsed_time_seconds: number
}

// Result (end of turn)
export type ResultEvent = {
  type: "result"
  subtype: "success" | "error"
  is_error: boolean
  total_cost_usd: number
  num_turns: number
}

// Keep alive (ignore)
export type KeepAliveEvent = {
  type: "keep_alive"
}

// ============================================================================
// API Response Types
// ============================================================================

export type SessionsResponse = {
  data: Session[]
}

export type EventsResponse = {
  data: SessionEvent[]
  has_more: boolean
  first_id: string
  last_id: string
}

export type EnvironmentsResponse = {
  environments: Environment[]
  has_more: boolean
  first_id: string
  last_id: string
}

// ============================================================================
// Tool Input Types (Claude Code specific)
// ============================================================================

export type WriteToolInput = {
  file_path: string
  content: string
}

export type EditToolInput = {
  file_path: string
  old_string: string
  new_string: string
}

// ============================================================================
// Type Guards
// ============================================================================

export function isUserTextMessage(event: UserEvent): event is UserEvent & { message: { content: string } } {
  return typeof event.message.content === "string"
}

export function isUserMultipartMessage(
  event: UserEvent
): event is UserEvent & { message: { content: (ImageBlockParam | TextBlockParam)[] } } {
  return (
    Array.isArray(event.message.content) &&
    event.message.content.length > 0 &&
    (event.message.content[0].type === "image" || event.message.content[0].type === "text")
  )
}

export function isToolResult(event: UserEvent): event is UserEvent & { message: { content: ToolResultBlock[] } } {
  return Array.isArray(event.message.content) && event.message.content.length > 0 && event.message.content[0].type === "tool_result"
}

export function getToolResultText(content: ToolResultBlock["content"]): string {
  if (Array.isArray(content)) {
    return content
      .filter((block): block is TextBlockParam => block.type === "text")
      .map((block) => block.text)
      .join("\n")
  }
  return content
}

export function isWriteToolInput(input: unknown): input is WriteToolInput {
  if (typeof input !== "object" || input === null) return false
  const obj = input as Record<string, unknown>
  return typeof obj.file_path === "string" && typeof obj.content === "string"
}

export function isEditToolInput(input: unknown): input is EditToolInput {
  if (typeof input !== "object" || input === null) return false
  const obj = input as Record<string, unknown>
  return typeof obj.file_path === "string" && typeof obj.old_string === "string" && typeof obj.new_string === "string"
}
