"use client"

import { useMemo, useCallback } from "react"
import { useSessionStream } from "@/lib/hooks/useSessionStream"
import type { Session, SessionEvent } from "@/lib/types/anthropic_session"
import { OutputDisplay } from "./OutputDisplay"

type SessionViewClientProps = {
  session: Session
  initialEvents: SessionEvent[]
}

// Check if agent is currently working (processing a request)
function computeIsAgentWorking(events: SessionEvent[]): boolean {
  if (events.length === 0) return false
  const lastEvent = events[events.length - 1]

  // If last event is a user message, agent is working on response
  if (lastEvent.type === "user") return true

  // If last event is assistant but hasn't finished (stop_reason !== "end_turn"), still working
  if (lastEvent.type === "assistant") {
    return lastEvent.message.stop_reason !== "end_turn"
  }

  return false
}

export function SessionViewClient({ session, initialEvents }: SessionViewClientProps) {
  const { liveEvents, pendingMessages, connectionState, sendMessage, sendControlMessage, reconnect } = useSessionStream(
    session.id,
    initialEvents
  )

  // Combine initial events, live events, and pending messages (dedupe by UUID)
  const allEvents = useMemo(() => {
    const seen = new Set<string>()
    const result: SessionEvent[] = []

    // Initial events first (from API)
    for (const event of initialEvents) {
      const uuid = "uuid" in event ? event.uuid : null
      if (uuid) seen.add(uuid)
      result.push(event)
    }

    // Live events (skip if already in initial)
    for (const event of liveEvents) {
      const uuid = "uuid" in event ? event.uuid : null
      if (uuid && seen.has(uuid)) continue
      if (uuid) seen.add(uuid)
      result.push(event)
    }

    // Pending messages (skip if already confirmed)
    for (const event of pendingMessages) {
      if (seen.has(event.uuid)) continue
      result.push(event)
    }

    return result
  }, [initialEvents, liveEvents, pendingMessages])

  const isAgentWorking = useMemo(() => computeIsAgentWorking(allEvents), [allEvents])

  const handleStop = useCallback(() => {
    sendControlMessage("interrupt")
  }, [sendControlMessage])

  return (
    <OutputDisplay
      events={allEvents}
      onSendMessage={sendMessage}
      onStop={handleStop}
      isAgentWorking={isAgentWorking}
      connectionState={connectionState}
      onReconnect={reconnect}
      session={session}
    />
  )
}
