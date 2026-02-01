"use client"

import { useEffect, useRef, useState, type KeyboardEvent, memo } from "react"
import {
  isToolResult,
  type SessionEvent,
  type ImageBlockParam,
  type TextBlockParam,
  type Base64ImageSource,
  type ToolResultBlock,
  type MessageContent,
  type Session,
  type ConnectionState,
} from "@/lib/types/anthropic_session"
import { useMemo } from "react"
import { EventRenderer } from "./events/EventRenderer"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ImageIcon, ArrowUp, X, StopCircle, Loader2, RotateCcw, GitPullRequestDraft, File } from "lucide-react"
import { useFilesPanelStore } from "@/lib/stores/files-panel-store"
import { ActivitySpinner } from "@/components/ui/activity-spinner"

type UploadedImage = {
  file: File
  preview: string
  base64: string
  mediaType: Base64ImageSource["media_type"]
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]

// Separate input component to isolate state changes
function InputBar({
  onSendMessage,
  onStop,
  isAgentWorking,
  connectionState,
  onReconnect,
  session,
}: {
  onSendMessage?: (message: MessageContent) => void
  onStop?: () => void
  isAgentWorking: boolean
  connectionState?: ConnectionState
  onReconnect?: () => void
  session?: Session
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState("")
  const [images, setImages] = useState<UploadedImage[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [isStopping, setIsStopping] = useState(false)

  const handleStop = () => {
    if (onStop && !isStopping) {
      setIsStopping(true)
      onStop()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value)
    // Auto-resize
    e.target.style.height = "auto"
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return

    const newImages: UploadedImage[] = []
    for (const file of Array.from(files)) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) continue

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })

      const base64 = dataUrl.split(",")[1]
      const mediaType = file.type as Base64ImageSource["media_type"]
      newImages.push({ file, preview: dataUrl, base64, mediaType })
    }

    setImages((prev) => [...prev, ...newImages])
    e.target.value = ""
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSend = () => {
    if ((!inputValue.trim() && images.length === 0) || !onSendMessage) return

    setIsStopping(false) // Reset stopping state when sending new message

    if (images.length > 0) {
      const content: (ImageBlockParam | TextBlockParam)[] = [
        ...images.map(
          (img): ImageBlockParam => ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.base64 },
          })
        ),
        ...(inputValue.trim() ? [{ type: "text" as const, text: inputValue }] : []),
      ]
      onSendMessage(content)
    } else {
      onSendMessage(inputValue)
    }

    setInputValue("")
    setImages([])
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const canSend = (inputValue.trim().length > 0 || images.length > 0) && onSendMessage

  // Extract git info for Create PR button
  const gitOutcome = session?.session_context?.outcomes?.find((o) => o.type === "git_repository")
  const repo = gitOutcome?.git_info?.repo
  const branch = gitOutcome?.git_info?.branches?.[0]
  const canCreatePR = repo && branch

  // Build GitHub PR URL
  const prUrl = repo && branch ? `https://github.com/${repo}/compare/${branch}?expand=1` : ""

  // Files panel state - show button when panel is closed (user may want to upload)
  const { isOpen, open: openFilesPanel } = useFilesPanelStore()
  const sessionId = session?.id
  const isFilesPanelOpen = sessionId ? isOpen(sessionId) : false
  const showFilesButton = !isFilesPanelOpen && !!sessionId

  const showConnectionRetry = connectionState === "disconnected" || connectionState === "error"

  return (
    <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col items-center pointer-events-none">
      {/* Retry connection - centered above input */}
      {showConnectionRetry && onReconnect && (
        <div className="w-[min(85%,768px)] flex justify-center mb-2 pointer-events-auto">
          <Button variant="outline" size="sm" onClick={onReconnect} className="h-8 px-3 text-[13px] font-normal text-text-200 gap-1.5">
            <RotateCcw className="size-3.5" />
            Retry connection
          </Button>
        </div>
      )}

      {/* Action buttons - right aligned above input */}
      {(canCreatePR || showFilesButton) && (
        <div className="w-[min(85%,768px)] flex justify-end gap-2 mb-2 pointer-events-auto">
          {showFilesButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openFilesPanel(sessionId!)}
              className="h-8 px-3 text-[13px] font-normal text-text-200 gap-1.5"
            >
              File drop
              <File className="size-3.5 text-accent-main-100" />
            </Button>
          )}
          {canCreatePR && (
            <Button variant="outline" size="sm" asChild className="h-8 px-3 text-[13px] font-normal text-text-200 gap-1.5">
              <a href={prUrl} target="_blank" rel="noopener noreferrer">
                Create PR
                <GitPullRequestDraft className="size-3.5 text-accent-main-100" />
              </a>
            </Button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={handleImageSelect}
        className="hidden"
      />
      <div className="group relative bg-bg-000 w-[min(85%,768px)] rounded-lg transition-all duration-200 overflow-hidden border-[0.5px] border-border-300 focus-within:border-border-300/80 pointer-events-auto">
        {/* Image previews */}
        {images.length > 0 && (
          <div className="flex gap-3 flex-wrap p-3 pb-0">
            {images.map((img, index) => (
              <div key={index} className="relative group/thumbnail">
                <button
                  onClick={() => setPreviewImage(img.preview)}
                  className="w-[120px] h-[120px] rounded-lg overflow-hidden border-[0.5px] border-border-300/25 hover:border-border-300/50 cursor-pointer transition-all"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- User-uploaded image */}
                  <img src={img.preview} alt={`Upload ${index + 1}`} className="w-full h-full object-cover" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeImage(index)
                  }}
                  className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-text-100 text-bg-000 flex items-center justify-center opacity-0 group-hover/thumbnail:opacity-100 transition-opacity"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="px-3 pt-3 pb-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Reply..."
            className="text-sm font-book w-full bg-transparent border-0 resize-none text-text-000 placeholder-text-500/80 overflow-auto p-0 block focus:outline-none min-h-[20px] max-h-[200px]"
            rows={1}
          />
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-1.5 p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="p-1.5 rounded-md text-text-300 hover:text-text-100 hover:bg-bg-100 active:scale-95 transition duration-300"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="size-3.5" />
          </Button>

          <div className="flex-1" />

          {canSend && (
            <Button onClick={handleSend} size="icon-sm" className="h-6 w-6 rounded-md bg-accent-main-100 hover:bg-accent-main-200">
              <ArrowUp className="size-4 text-white" />
            </Button>
          )}
          {!canSend && isAgentWorking && (
            <Button
              onClick={handleStop}
              disabled={isStopping}
              size="icon-sm"
              className="h-6 w-6 rounded-md bg-white border border-text-400 hover:bg-bg-100"
            >
              {isStopping ? <Loader2 className="size-4 text-text-300 animate-spin" /> : <StopCircle className="size-4 text-text-200" />}
            </Button>
          )}
          {!canSend && !isAgentWorking && (
            <Button disabled size="icon-sm" className="h-6 w-6 rounded-md bg-accent-main-100/70">
              <ArrowUp className="size-4 text-white" />
            </Button>
          )}
        </div>
      </div>

      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 flex items-center justify-center">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {previewImage && (
            // eslint-disable-next-line @next/next/no-img-element -- User-uploaded image
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[85vh] object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

const THINKING_PHRASES = [
  "Analyzing",
  "Conjuring",
  "Decoding",
  "Devising",
  "Dissecting",
  "Extrapolating",
  "Fathoming",
  "Figuring",
  "Hypothesizing",
  "Iterating",
  "Navigating",
  "Parsing",
  "Probing",
  "Reasoning",
  "Sleuthing",
  "Solving",
  "Speculating",
  "Theorizing",
  "Thinking",
]

// Thinking indicator shown while waiting for assistant response
function ThinkingIndicator() {
  const [phrase] = useState(() => THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)])

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="-translate-y-[5px]">
        <ActivitySpinner />
      </span>
      <span className="font-mono font-medium text-accent-main-100">{phrase}...</span>
    </div>
  )
}

// Check if we should show thinking indicator
// Show when: last event is user message, OR last assistant event hasn't finished (stop_reason !== "end_turn")
function shouldShowThinking(events: SessionEvent[]): boolean {
  if (events.length === 0) return false
  const lastEvent = events[events.length - 1]

  // If last event is a user event (message or tool result), show thinking
  if (lastEvent.type === "user") return true

  // If last event is assistant but hasn't finished (called tools), show thinking
  if (lastEvent.type === "assistant") {
    const stopReason = lastEvent.message.stop_reason
    return stopReason !== "end_turn"
  }

  return false
}

// Memoized events list to prevent rerenders from input changes
const EventsList = memo(function EventsList({
  filteredEvents,
  allEvents,
  toolResultsMap,
  subagentEventsMap,
}: {
  filteredEvents: SessionEvent[]
  allEvents: SessionEvent[]
  toolResultsMap: Map<string, ToolResultBlock>
  subagentEventsMap: Map<string, SessionEvent[]>
}) {
  const showThinking = shouldShowThinking(allEvents)

  return (
    <>
      {filteredEvents.map((event, index) => (
        <EventRenderer key={`${event.type}-${index}`} event={event} toolResultsMap={toolResultsMap} subagentEventsMap={subagentEventsMap} />
      ))}
      {showThinking && <ThinkingIndicator />}
    </>
  )
})

type OutputDisplayProps = {
  events: SessionEvent[]
  onSendMessage?: (message: MessageContent) => void
  onStop?: () => void
  isAgentWorking?: boolean
  connectionState?: ConnectionState
  onReconnect?: () => void
  session?: Session
}

export function OutputDisplay({
  events,
  onSendMessage,
  onStop,
  isAgentWorking = false,
  connectionState,
  onReconnect,
  session,
}: OutputDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  // Build a map of tool_use_id -> tool result for grouping
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultBlock>()
    for (const event of events) {
      if (event.type === "user" && isToolResult(event)) {
        for (const block of event.message.content) {
          map.set(block.tool_use_id, block)
        }
      }
    }
    return map
  }, [events])

  // Build a map of parent_tool_use_id -> subagent events (for Task tool rendering)
  const subagentEventsMap = useMemo(() => {
    const map = new Map<string, SessionEvent[]>()
    for (const event of events) {
      if ((event.type === "user" || event.type === "assistant") && event.parent_tool_use_id) {
        const existing = map.get(event.parent_tool_use_id) || []
        existing.push(event)
        map.set(event.parent_tool_use_id, existing)
      }
    }
    return map
  }, [events])

  // Filter out:
  // 1. tool_result user events (they'll be rendered inline with tool_use)
  // 2. events with parent_tool_use_id (they'll be rendered inline with Task tool)
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Filter out subagent messages (rendered inline with Task)
      if ((event.type === "user" || event.type === "assistant") && event.parent_tool_use_id) {
        return false
      }
      // Filter out tool results (rendered inline with tool_use)
      if (event.type === "user" && isToolResult(event)) {
        return false
      }
      return true
    })
  }, [events])

  // Check if scrolled to bottom
  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50)
  }

  // Only auto-scroll if already at bottom
  useEffect(() => {
    if (isAtBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [events, isAtBottom])

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      {/* Scrollable events area */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-bg-000 py-4 pb-40">
        <div className="w-[min(85%,768px)] mx-auto space-y-3">
          <EventsList
            filteredEvents={filteredEvents}
            allEvents={events}
            toolResultsMap={toolResultsMap}
            subagentEventsMap={subagentEventsMap}
          />
        </div>
      </div>

      {/* Floating input bar at bottom */}
      <InputBar
        onSendMessage={onSendMessage}
        onStop={onStop}
        isAgentWorking={isAgentWorking}
        connectionState={connectionState}
        onReconnect={onReconnect}
        session={session}
      />
    </div>
  )
}
