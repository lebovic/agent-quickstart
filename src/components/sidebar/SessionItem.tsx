"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { format, isToday } from "date-fns"
import { Archive, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ActivitySpinner } from "@/components/ui/activity-spinner"
import { useSessionStore } from "@/lib/stores/session-store"
import { useActivityStore, ACTIVITY_TIMEOUT } from "@/lib/stores/activity-store"
import type { Session, SessionsResponse } from "@/lib/types/anthropic_session"

type SessionItemProps = {
  session: Session
}

export function SessionItem({ session }: SessionItemProps) {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const isActive = pathname === `/code/${session.id}`

  // Extract repo name from git source URL
  const repoUrl = session.session_context.sources[0]?.url || ""
  const repoName = repoUrl ? repoUrl.split("/").slice(-2).join("/").replace(".git", "") : ""

  // Format time: specific time if today (e.g. 10:02am), otherwise abbreviated day (e.g. Mon)
  const updatedDate = new Date(session.updated_at)
  const timeDisplay = isToday(updatedDate) ? format(updatedDate, "h:mma").toLowerCase() : format(updatedDate, "EEE")

  const handleArchive = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Check if viewing this session at action time (not stale from render)
    const isStillActive = window.location.pathname === `/code/${session.id}`

    const res = await fetch(`/api/v1/sessions/${session.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    if (res.ok) {
      const updatedSession: Session = await res.json()
      queryClient.setQueryData<SessionsResponse>(["sessions"], (old) => {
        if (!old) return old
        return {
          ...old,
          data: old.data.map((s) => (s.id === updatedSession.id ? updatedSession : s)),
        }
      })
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
      toast.success("Session archived")
      if (isStillActive) {
        router.push("/code")
      }
    }
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async () => {
    // Check if still viewing this session at confirmation time (not stale from render)
    const isStillActive = window.location.pathname === `/code/${session.id}`

    const res = await fetch(`/api/v1/sessions/${session.id}`, {
      method: "DELETE",
    })

    if (res.ok) {
      queryClient.setQueryData<SessionsResponse>(["sessions"], (old) => {
        if (!old) return old
        return {
          ...old,
          data: old.data.filter((s) => s.id !== session.id),
        }
      })
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
      toast.success("Session deleted")
      if (isStillActive) {
        router.push("/code")
      }
    } else {
      const data = await res.json().catch(() => null)
      toast.error(data?.error?.message || "Failed to delete session")
    }
    setShowDeleteDialog(false)
  }

  const isArchived = session.session_status === "archived"

  // Check for pending messages to show spinner immediately when user sends
  const hasPending = useSessionStore((state) => (state.pendingMessages[session.id]?.length ?? 0) > 0)

  // Check if session has recent activity (updated via activity store's global clock)
  const isRecentlyActive = useActivityStore((state) => state.currentTime - (state.lastActivityTime[session.id] ?? 0) < ACTIVITY_TIMEOUT)

  // Show spinner if: has pending messages OR (running with recent activity)
  const isRunning = hasPending || (session.session_status === "running" && isRecentlyActive)

  return (
    <>
      <Link
        href={`/code/${session.id}`}
        className={cn(
          "group relative p-2 rounded-md cursor-pointer transition-all flex items-center gap-2 hover:bg-bg-300",
          isActive && "bg-bg-400"
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-col min-w-0">
            <p className="text-sm font-book text-text-100 leading-snug truncate">{session.title}</p>
            <span className="text-xs text-text-500 flex min-w-0 items-center">
              {repoName && (
                <>
                  <span className="truncate">{repoName}</span>
                  <span className="mx-1">·</span>
                </>
              )}
              <span className="whitespace-nowrap">{timeDisplay}</span>
            </span>
          </div>
        </div>
        {isRunning && (
          <div className="shrink-0 pr-1 self-center -translate-y-1">
            <ActivitySpinner className="text-accent-main-100" />
          </div>
        )}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDeleteClick}
            className="h-6 w-6 bg-bg-300 text-text-500 hover:text-text-100"
            title="Delete session"
          >
            <Trash2 className="size-4" />
          </Button>
          {!isArchived && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleArchive}
              className="h-6 w-6 bg-bg-300 text-text-500 hover:text-text-100"
              title="Archive session"
            >
              <Archive className="size-4" />
            </Button>
          )}
        </div>
      </Link>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the session and its container. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
