"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import type { Session, SessionsResponse } from "@/lib/types/anthropic_session"
import { ArrowLeft, Cloud, Terminal, Copy, ChevronDown, Pencil, Archive, PanelRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { usePreferencesStore } from "@/lib/stores/preferences-store"
import { useFilesPanelStore } from "@/lib/stores/files-panel-store"
import { clientConfig } from "@/config.client"
import { cn } from "@/lib/utils"

type SessionHeaderProps = {
  session: Session
}

async function updateSession(sessionId: string, updates: { title?: string; session_status?: string }) {
  const res = await fetch(`/api/v1/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  })
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(errorText || "Failed to update session")
  }
  return res.json()
}

export function SessionHeader({ session }: SessionHeaderProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { provider } = usePreferencesStore()
  const { isOpen, toggle: toggleFilesPanel } = useFilesPanelStore()
  const filesPanelOpen = isOpen(session.id)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [newTitle, setNewTitle] = useState(session.title)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)

  // Extract repo and branch from outcomes
  const gitOutcome = session.session_context?.outcomes?.find((o) => o.type === "git_repository")
  const repo = gitOutcome?.git_info?.repo
  const branch = gitOutcome?.git_info?.branches?.[0]
  const fullBranchPath = repo && branch ? `${repo}/${branch}` : branch || ""
  const truncatedBranch = fullBranchPath.length > 20 ? fullBranchPath.slice(0, 20) + "…" : fullBranchPath
  const statusColors: Record<string, string> = {
    running: "bg-blue-500",
    idle: "border-[1.5px] border-blue-500 bg-white",
    paused: "bg-yellow-500",
    completed: "border-[1.5px] border-blue-500 bg-white",
    failed: "bg-red-500",
    archived: "border-[1.5px] border-blue-400 bg-white",
  }

  const handleCopyCommand = async () => {
    const command = `claude --teleport ${session.id}`
    await navigator.clipboard.writeText(command)
    toast.success("Command copied to clipboard")
  }

  const handleCopyBranch = async () => {
    await navigator.clipboard.writeText(fullBranchPath)
    toast.success("Branch copied to clipboard")
  }

  const handleRename = async () => {
    if (!newTitle.trim() || newTitle === session.title) {
      setRenameDialogOpen(false)
      return
    }

    setIsRenaming(true)
    try {
      const updatedSession = await updateSession(session.id, { title: newTitle.trim() })
      // Optimistically update the sessions list cache
      queryClient.setQueryData<SessionsResponse>(["sessions"], (old) => {
        if (!old) return old
        return {
          ...old,
          data: old.data.map((s) => (s.id === session.id ? updatedSession : s)),
        }
      })
      queryClient.setQueryData(["session", session.id], updatedSession)
      toast.success("Session renamed")
      setRenameDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename session")
    } finally {
      setIsRenaming(false)
    }
  }

  const handleArchive = async () => {
    setIsArchiving(true)
    try {
      const res = await fetch(`/api/v1/sessions/${session.id}/archive`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to archive session")
      const updatedSession = await res.json()
      // Optimistically update the sessions list cache
      queryClient.setQueryData<SessionsResponse>(["sessions"], (old) => {
        if (!old) return old
        return {
          ...old,
          data: old.data.map((s) => (s.id === session.id ? updatedSession : s)),
        }
      })
      queryClient.setQueryData(["session", session.id], updatedSession)
      toast.success("Session archived")
      router.push("/")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive session")
    } finally {
      setIsArchiving(false)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleRename()
    }
  }

  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-border-300 bg-bg-000">
      <div className="flex items-center gap-3">
        {/* Mobile back arrow */}
        <Link href="/code" className="md:hidden p-1 -ml-2 mr-1">
          <ArrowLeft className="size-5 text-text-200" />
        </Link>

        {/* Cloud icon with status bullet */}
        <div className="relative">
          <Cloud className="size-5 text-text-400" />
          <span
            className={`absolute bottom-0.5 -right-0.5 size-2 rounded-full ${statusColors[session.session_status] || "border-[1.5px] border-blue-500 bg-white"}`}
          />
        </div>

        {/* Title with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-[14px] font-normal text-text-100 gap-1">
              {session.title}
              <ChevronDown className="size-4 text-text-400 translate-y-px" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setNewTitle(session.title)
                setRenameDialogOpen(true)
              }}
            >
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleArchive} disabled={isArchiving || session.session_status === "archived"}>
              <Archive className="size-4" />
              {isArchiving ? "Archiving..." : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-3">
          {fullBranchPath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyBranch}
              className="h-auto py-1 px-2 text-[12px] font-mono text-text-300 hover:text-text-200 gap-1.5"
            >
              {truncatedBranch}
              <Copy className="size-3" />
            </Button>
          )}
          {provider === "debug" && (
            <Button variant="outline" size="sm" className="text-[12px] font-normal gap-1.5" onClick={handleCopyCommand}>
              Open in CLI
              <Terminal className="size-3.5 text-accent-main-100" />
            </Button>
          )}
        </div>
        {clientConfig.sessionFilesEnabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => toggleFilesPanel(session.id)}
                className="md:hidden text-text-400 hover:text-text-100"
              >
                <PanelRight className={cn("size-4", filesPanelOpen && "text-accent-main-100")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{filesPanelOpen ? "Close files" : "Open files"}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            placeholder="Session title"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={isRenaming || !newTitle.trim()}>
              {isRenaming ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  )
}
