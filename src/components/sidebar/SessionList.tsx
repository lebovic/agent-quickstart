"use client"

import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { SessionItem } from "./SessionItem"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ListFilter, Check } from "lucide-react"
import { useActivityStore } from "@/lib/stores/activity-store"
import type { SessionsResponse, Session } from "@/lib/types/anthropic_session"

type FilterOption = "active" | "archived" | "all"

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
]

async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/v1/sessions")
  if (!res.ok) throw new Error("Failed to fetch sessions")
  return res.json()
}

function filterSessions(sessions: Session[], filter: FilterOption): Session[] {
  if (filter === "all") return sessions
  if (filter === "archived") return sessions.filter((s) => s.session_status === "archived")
  // "active" = everything except archived
  return sessions.filter((s) => s.session_status !== "archived")
}

export function SessionList() {
  const [filter, setFilter] = useState<FilterOption>("active")
  const [filterOpen, setFilterOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
    refetchInterval: 15_000,
  })

  // Sync session updated_at timestamps to activity store when polling
  useEffect(() => {
    if (!data?.data) return
    const { setLastActivity } = useActivityStore.getState()
    for (const session of data.data) {
      setLastActivity(session.id, new Date(session.updated_at).getTime())
    }
  }, [data])

  const filteredSessions = data?.data ? filterSessions(data.data, filter) : []

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-normal text-text-500">Sessions</span>
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-text-500 h-6 w-6">
              <ListFilter className="size-2.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-36 p-1" align="end">
            {FILTER_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant="ghost"
                onClick={() => {
                  setFilter(option.value)
                  setFilterOpen(false)
                }}
                className="w-full justify-between px-2 py-1.5 h-auto font-normal"
              >
                <span>{option.label}</span>
                {filter === option.value && <Check className="size-4 text-orange-500" />}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <nav className="flex-1 overflow-y-auto space-y-0.5 px-2 pb-4">
        {isLoading && (
          <div className="space-y-2 px-1">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {error && <div className="px-3 py-2 text-sm text-destructive">Failed to load</div>}
        {filteredSessions.map((session) => (
          <SessionItem key={session.id} session={session} />
        ))}
      </nav>
    </div>
  )
}
