"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { PanelRight, Upload, File, Loader2, Download, X } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useFilesPanelStore } from "@/lib/stores/files-panel-store"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "sonner"
import type { ListFilesResponse, FileResponse, PresignedUrlResponse } from "@/lib/schemas/file"
import { cn } from "@/lib/utils"

const MIN_WIDTH = 240
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 340
const COLLAPSED_WIDTH = 56

type FilesPanelProps = {
  sessionId: string
}

async function fetchFiles(sessionId: string): Promise<ListFilesResponse> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/files`)
  if (!res.ok) throw new Error("Failed to fetch files")
  return res.json()
}

async function uploadFile(sessionId: string, file: globalThis.File): Promise<FileResponse> {
  const formData = new FormData()
  formData.append("file", file)
  const res = await fetch(`/api/v1/sessions/${sessionId}/files`, {
    method: "POST",
    body: formData,
  })
  if (!res.ok) {
    throw new Error("Failed to upload file")
  }
  return res.json()
}

async function getPresignedUrl(sessionId: string, fileId: string): Promise<PresignedUrlResponse> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/files/${fileId}/presigned-url`)
  if (!res.ok) throw new Error("Failed to get download URL")
  return res.json()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type FileItemProps = {
  file: FileResponse
  sessionId: string
}

function FileItem({ file, sessionId }: FileItemProps) {
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const { url } = await getPresignedUrl(sessionId, file.id)
      window.open(url, "_blank")
    } catch {
      toast.error("Failed to download file")
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={isDownloading}
      className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-bg-300 rounded-md transition-colors disabled:opacity-50"
    >
      <File className="size-4 text-text-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-100 truncate">{file.filename}</div>
        <div className="text-xs text-text-400">{formatFileSize(file.size_bytes)}</div>
      </div>
      {isDownloading ? (
        <Loader2 className="size-4 text-text-400 animate-spin shrink-0" />
      ) : (
        <Download className="size-4 text-text-400 shrink-0" />
      )}
    </button>
  )
}

function FilesPanelContent({ sessionId, onCollapse, isMobile }: FilesPanelProps & { onCollapse: () => void; isMobile?: boolean }) {
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { onFilesLoaded } = useFilesPanelStore()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["files", sessionId],
    queryFn: async () => {
      const result = await fetchFiles(sessionId)
      onFilesLoaded(sessionId, result.data.length)
      return result
    },
    refetchInterval: 15_000,
  })

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      await uploadFile(sessionId, file)
      toast.success("File uploaded")
      refetch()
    } catch {
      toast.error("Failed to upload file")
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <div className="flex flex-col h-full min-w-[240px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-sm font-medium text-text-100">Files</h2>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleUploadClick}
                disabled={isUploading}
                className="text-text-400 hover:text-text-100"
              >
                {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Upload file</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onCollapse} className="text-text-400 hover:text-text-100 hover:bg-bg-300">
                {isMobile ? <X className="size-4" /> : <PanelRight className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isMobile ? "Close" : "Collapse panel"}</TooltipContent>
          </Tooltip>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/*,application/json"
        />
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-5 text-text-400 animate-spin" />
          </div>
        ) : data?.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm">
            <File className="size-8 mb-2 opacity-50" />
            <p>No files yet</p>
            <p className="text-xs mt-1">Files saved to /persistent/ will appear here</p>
          </div>
        ) : (
          <div className="space-y-1">
            {data?.data.map((file) => (
              <FileItem key={file.id} file={file} sessionId={sessionId} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function FilesPanel({ sessionId }: FilesPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const isMobile = useIsMobile()
  const { isOpen, open, close, onFilesLoaded } = useFilesPanelStore()

  // Query runs regardless of panel visibility for auto-open detection
  useQuery({
    queryKey: ["files", sessionId],
    queryFn: async () => {
      const result = await fetchFiles(sessionId)
      onFilesLoaded(sessionId, result.data.length)
      return result
    },
    refetchInterval: 15_000,
  })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !panelRef.current) return

      const panelRect = panelRef.current.getBoundingClientRect()
      const newWidth = panelRect.right - e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
      }
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Mobile: use Sheet (no close button)
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
        <SheetContent side="right" className="w-full p-0 bg-bg-200 [&>button]:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Files</SheetTitle>
          </SheetHeader>
          <FilesPanelContent sessionId={sessionId} onCollapse={close} isMobile />
        </SheetContent>
      </Sheet>
    )
  }

  const panelWidth = isOpen ? width : COLLAPSED_WIDTH

  // Desktop: resizable panel with collapsed state
  return (
    <aside
      ref={panelRef}
      className={cn(
        "relative flex flex-col bg-bg-200 border-l-[0.5px] border-border-300",
        isDragging ? "" : "transition-[width] duration-200"
      )}
      style={{ width: panelWidth }}
    >
      {isOpen ? (
        <>
          <FilesPanelContent sessionId={sessionId} onCollapse={close} />

          {/* Resize handle on LEFT side */}
          <div onMouseDown={handleMouseDown} className="absolute top-0 -left-px w-[3px] h-full cursor-col-resize group">
            <div className={cn("w-[2px] h-full mx-auto transition-colors", isDragging ? "bg-primary/50" : "group-hover:bg-primary/30")} />
          </div>
        </>
      ) : (
        // Collapsed state - just the expand button
        <div className="flex flex-col h-full items-center py-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={open} className="text-text-400 hover:text-text-100 hover:bg-bg-300">
                <PanelRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Expand panel</TooltipContent>
          </Tooltip>
        </div>
      )}
    </aside>
  )
}
