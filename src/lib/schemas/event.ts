import { z } from "zod"

// Common fields for conversation events
const eventBase = {
  uuid: z.string().uuid(),
  session_id: z.string().optional(),
  subtype: z.string().optional(),
  parent_tool_use_id: z.string().nullable().optional(),
}

// Control request from Claude (e.g., permission requests like can_use_tool)
export const ControlRequest = z.object({
  type: z.literal("control_request"),
  request_id: z.string(),
  request: z
    .object({
      subtype: z.string(),
    })
    .passthrough(),
})

export type ControlRequest = z.infer<typeof ControlRequest>

// Control response from Claude (response to our control_request)
export const ControlResponse = z.object({
  type: z.literal("control_response"),
  response: z
    .object({
      request_id: z.string(),
      subtype: z.string(),
    })
    .passthrough(),
})

export type ControlResponse = z.infer<typeof ControlResponse>

// Content blocks for user messages - text block is fully typed for narrowing, others use passthrough
const TextBlock = z.object({ type: z.literal("text"), text: z.string() })
const OtherBlock = z.object({ type: z.string() }).passthrough()

// Specific event types with literal type values
export const UserEvent = z.object({
  type: z.literal("user"),
  ...eventBase,
  message: z
    .object({
      role: z.literal("user"),
      content: z.union([z.string(), z.array(z.union([TextBlock, OtherBlock]))]),
    })
    .optional(),
})

export const AssistantEvent = z
  .object({
    type: z.literal("assistant"),
    ...eventBase,
  })
  .passthrough()

export const ToolUseEvent = z
  .object({
    type: z.literal("tool_use"),
    ...eventBase,
  })
  .passthrough()

export const ToolResultEvent = z
  .object({
    type: z.literal("tool_result"),
    ...eventBase,
  })
  .passthrough()

export const SystemEvent = z
  .object({
    type: z.literal("system"),
    ...eventBase,
  })
  .passthrough()

export const ResultEvent = z
  .object({
    type: z.literal("result"),
    ...eventBase,
  })
  .passthrough()

// Discriminated union for all WebSocket ingress messages
export const IngressMessage = z.discriminatedUnion("type", [
  ControlRequest,
  ControlResponse,
  UserEvent,
  AssistantEvent,
  ToolUseEvent,
  ToolResultEvent,
  SystemEvent,
  ResultEvent,
])

export type IngressMessage = z.infer<typeof IngressMessage>

// Generic event schema for backwards compatibility
export const BaseEvent = z
  .object({
    uuid: z.string().uuid(),
    type: z.string(),
    session_id: z.string().optional(),
    subtype: z.string().optional(),
    parent_tool_use_id: z.string().nullable().optional(),
  })
  .passthrough()

export type BaseEvent = z.infer<typeof BaseEvent>

// Events in POST /v1/sessions come wrapped: { type: "event", data: { uuid, type, ... } }
export const WrappedEvent = z.object({
  type: z.literal("event"),
  data: BaseEvent,
})

// Accept either wrapped or unwrapped events
export const InputEvent = z.union([WrappedEvent, BaseEvent])

export type InputEvent = z.infer<typeof InputEvent>

export function parseEventData(data: unknown): BaseEvent {
  return BaseEvent.parse(data)
}

// Schema for user text message events (used for stdin input to container)
export const UserTextMessage = z.object({
  type: z.literal("user"),
  uuid: z.string().uuid(),
  session_id: z.string().optional(),
  parent_tool_use_id: z.string().nullable().optional(),
  message: z.object({
    role: z.literal("user"),
    content: z.string(),
  }),
})

/**
 * Extract the actual event from an input that may be wrapped or unwrapped.
 * Returns a discriminated union type for proper type narrowing.
 */
export function extractIngressEvent(input: InputEvent): IngressMessage {
  const wrapped = WrappedEvent.safeParse(input)
  if (wrapped.success) {
    return IngressMessage.parse(wrapped.data.data)
  }
  return IngressMessage.parse(input)
}

// ============================================================================
// Tool Input Schemas
// ============================================================================

export const TodoItemSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  activeForm: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed"]),
})

export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema),
})

export type TodoItem = z.infer<typeof TodoItemSchema>
export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>
