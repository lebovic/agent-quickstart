"use client"

import { useState } from "react"
import {
  isUserTextMessage,
  isUserMultipartMessage,
  isToolResult,
  getToolResultText,
  type UserEvent,
  type ToolResultBlock,
} from "@/lib/types/anthropic_session"
import { useSessionStore } from "@/lib/stores/session-store"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

type Props = {
  event: UserEvent
}

function ToolResult({
  toolUseId: _toolUseId,
  content,
  isError,
}: {
  toolUseId: string
  content: ToolResultBlock["content"]
  isError?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const text = getToolResultText(content)
  const needsTruncation = text.length > 300
  const displayText = expanded || !needsTruncation ? text : text.slice(0, 300) + "…"

  return (
    <div
      className={`flex items-start gap-2 text-sm pl-4 ${needsTruncation && !expanded ? "cursor-pointer" : ""}`}
      onClick={() => needsTruncation && !expanded && setExpanded(true)}
    >
      <span className="text-text-500 shrink-0 text-xs select-none">└</span>
      <div className={`flex-1 min-w-0 font-mono text-[13px] ${isError ? "text-red-600" : "text-text-100"}`}>
        <div className="whitespace-pre-wrap break-all">{displayText}</div>
      </div>
    </div>
  )
}

function ImageThumbnail({ src, alt }: { src: string; alt: string }) {
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setPreviewOpen(true)}
        className="w-[120px] h-[120px] rounded-lg overflow-hidden border-[0.5px] border-border-300/25 hover:border-border-300/50 cursor-pointer transition-all"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- User-uploaded image */}
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </button>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 flex items-center justify-center">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element -- User-uploaded image */}
          <img src={src} alt={alt} className="max-w-full max-h-[85vh] object-contain rounded" />
        </DialogContent>
      </Dialog>
    </>
  )
}

export function UserEventComponent({ event }: Props) {
  const isPending = useSessionStore((state) => (state.pendingMessages[event.session_id] || []).some((m) => m.uuid === event.uuid))

  if (isUserTextMessage(event)) {
    return (
      <div className="flex justify-end">
        <div
          className={`rounded-lg bg-bg-300 px-3 py-2 text-sm font-book max-w-[85%] ${isPending ? "italic text-text-400" : "text-text-000"}`}
        >
          <p className="whitespace-pre-wrap break-words">{event.message.content}</p>
        </div>
      </div>
    )
  }

  if (isToolResult(event)) {
    return (
      <div className="space-y-1">
        {event.message.content.map((block, i) => (
          <ToolResult key={i} toolUseId={block.tool_use_id} content={block.content} isError={block.is_error} />
        ))}
      </div>
    )
  }

  if (isUserMultipartMessage(event)) {
    const images = event.message.content.filter((b) => b.type === "image")
    const textBlocks = event.message.content.filter((b) => b.type === "text")

    return (
      <div className="flex flex-col items-end gap-2">
        {images.length > 0 && (
          <div className="flex gap-3 flex-wrap justify-end">
            {images.map((block, i) => {
              const source = block.source
              const src = source.type === "base64" ? `data:${source.media_type};base64,${source.data}` : source.url
              return <ImageThumbnail key={i} src={src} alt={`Image ${i + 1}`} />
            })}
          </div>
        )}
        {textBlocks.length > 0 && (
          <div
            className={`rounded-lg bg-bg-300 px-3 py-2 text-sm font-book max-w-[85%] ${isPending ? "italic text-text-400" : "text-text-000"}`}
          >
            {textBlocks.map((block, i) => (
              <p key={i} className="whitespace-pre-wrap break-words">
                {block.text}
              </p>
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}
