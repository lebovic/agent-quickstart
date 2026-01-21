import type { SessionEvent, ToolResultBlock } from "@/lib/types/anthropic_session"
import { UserEventComponent } from "./UserEvent"
import { AssistantEventComponent } from "./AssistantEvent"

type EventRendererProps = {
  event: SessionEvent
  toolResultsMap: Map<string, ToolResultBlock>
  subagentEventsMap: Map<string, SessionEvent[]>
}

export function EventRenderer({ event, toolResultsMap, subagentEventsMap }: EventRendererProps) {
  if (event.type === "user") {
    return <UserEventComponent event={event} />
  }

  if (event.type === "assistant") {
    return <AssistantEventComponent event={event} toolResultsMap={toolResultsMap} subagentEventsMap={subagentEventsMap} />
  }

  // tool_progress: skipped for now - needs proper cleanup tracking (see PLANNING.md)
  // result, control_response, env_manager_log, system, keep_alive: not rendered
  return null
}
