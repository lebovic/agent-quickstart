"use client"

import { useQuery } from "@tanstack/react-query"
import { SessionHeader } from "./SessionHeader"
import { SessionViewClient } from "./SessionViewClient"
import type { Session, EventsResponse } from "@/lib/types/anthropic_session"

async function fetchSession(sessionId: string): Promise<Session> {
  const res = await fetch(`/api/v1/sessions/${sessionId}`)
  if (!res.ok) throw new Error("Failed to fetch session")
  return res.json()
}

async function fetchEvents(sessionId: string): Promise<EventsResponse> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/events`)
  if (!res.ok) throw new Error("Failed to fetch events")
  return res.json()
}

type Props = {
  sessionId: string
}

export function SessionPageClient({ sessionId }: Props) {
  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  const eventsQuery = useQuery({
    queryKey: ["events", sessionId],
    queryFn: () => fetchEvents(sessionId),
    staleTime: 0,
    refetchOnMount: "always", // Always refetch when returning to session
  })

  if (sessionQuery.isLoading || eventsQuery.isLoading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading session...</div>
  }

  if (sessionQuery.error || eventsQuery.error) {
    return <div className="flex items-center justify-center h-full text-red-500">Failed to load session</div>
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SessionHeader session={sessionQuery.data!} />
      <SessionViewClient initialEvents={eventsQuery.data!.data} session={sessionQuery.data!} />
    </div>
  )
}
