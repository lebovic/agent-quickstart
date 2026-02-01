"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { formatDistanceToNow } from "date-fns"
import { useQuery } from "@tanstack/react-query"
import { Upload, File, Loader2, Download, X, Trash2 } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useFilesPanelStore } from "@/lib/stores/files-panel-store"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
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
import { toast } from "sonner"
import type { ListFilesResponse, FileResponse, PresignedUrlResponse } from "@/lib/schemas/file"
import { cn } from "@/lib/utils"

const MIN_WIDTH = 240
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 340

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
    if (res.status === 409) {
      throw new Error("File with name already exists. To replace it, delete it first")
    }
    throw new Error("Failed to upload file")
  }
  return res.json()
}

async function getPresignedUrl(sessionId: string, fileId: string): Promise<PresignedUrlResponse> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/files/${fileId}/presigned-url`)
  if (!res.ok) throw new Error("Failed to get download URL")
  return res.json()
}

async function deleteFileApi(sessionId: string, fileId: string): Promise<void> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/files/${fileId}`, {
    method: "DELETE",
  })
  if (!res.ok) throw new Error("Failed to delete file")
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type FileItemProps = {
  file: FileResponse
  sessionId: string
  onDelete: (file: FileResponse) => void
}

function FileItem({ file, sessionId, onDelete }: FileItemProps) {
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

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(file)
  }

  const sourceLabel = file.source === "agent" ? "Agent" : "You"
  const timeAgo = formatDistanceToNow(new Date(file.created_at), { addSuffix: true })

  return (
    <div
      onClick={handleDownload}
      className={cn(
        "group flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-bg-300 rounded-md transition-colors cursor-pointer",
        isDownloading && "opacity-50 pointer-events-none"
      )}
    >
      <File className="size-4 text-text-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-100 truncate">{file.filename}</div>
        <div className="text-xs text-text-400">
          {formatFileSize(file.size_bytes)} · {sourceLabel} · {timeAgo}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleDeleteClick}
          className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-bg-400 text-text-400 hover:text-text-100"
        >
          <Trash2 className="size-4" />
        </button>
        {isDownloading ? <Loader2 className="size-4 text-text-400 animate-spin" /> : <Download className="size-4 text-text-400" />}
      </div>
    </div>
  )
}

function FilesPanelContent({ sessionId, onCollapse, isMobile }: FilesPanelProps & { onCollapse: () => void; isMobile?: boolean }) {
  const [isUploading, setIsUploading] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<FileResponse | null>(null)
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

  const handleUpload = async (file: globalThis.File) => {
    setIsUploading(true)
    try {
      await uploadFile(sessionId, file)
      toast.success("File uploaded")
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload file")
    } finally {
      setIsUploading(false)
    }
  }

  const handleDeleteClick = (file: FileResponse) => {
    setFileToDelete(file)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async () => {
    if (!fileToDelete) return
    try {
      await deleteFileApi(sessionId, fileToDelete.id)
      toast.success("File deleted")
      refetch()
    } catch {
      toast.error("Failed to delete file")
    }
    setShowDeleteDialog(false)
    setFileToDelete(null)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await handleUpload(file)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      await handleUpload(file)
    }
  }

  const handleDropzoneClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div
      className="relative flex flex-col h-full min-w-[240px]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Full-panel dropzone overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-accent-main-100/10 border-2 border-dashed border-accent-main-100 rounded-lg m-2">
          <Upload className="size-8 text-accent-main-100" />
          <span className="text-sm text-accent-main-100 font-medium">Drop file here</span>
        </div>
      )}

      {/* Header with title and close button */}
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="text-base font-normal text-text-100">This session</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onCollapse} className="text-text-400 hover:text-text-100 hover:bg-bg-300">
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isMobile ? "Close" : "Collapse panel"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Files section */}
      <div className="flex flex-col flex-1 min-h-0 mt-4">
        <div className="px-4 pb-2">
          <span className="text-xs font-normal text-text-500">File drop</span>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="size-5 text-text-400 animate-spin" />
            </div>
          ) : data?.data.length === 0 ? (
            <div className="text-text-400 text-sm px-3 py-2">No files yet</div>
          ) : (
            <div className="space-y-1">
              {data?.data.map((file) => (
                <FileItem key={file.id} file={file} sessionId={sessionId} onDelete={handleDeleteClick} />
              ))}
            </div>
          )}

          {/* Upload dropzone */}
          <div
            onClick={handleDropzoneClick}
            className="flex flex-col items-center justify-center gap-2 p-4 mt-2 border-2 border-dashed border-border-300 rounded-lg cursor-pointer transition-colors hover:border-text-400 hover:bg-bg-300/50"
          >
            {isUploading ? (
              <Loader2 className="size-5 text-text-400 animate-spin" />
            ) : (
              <>
                <Upload className="size-5 text-text-400" />
                <span className="text-xs text-text-400">Click or drop to upload</span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/*,application/json"
          />
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{fileToDelete?.filename}&quot;. This action cannot be undone.
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
    </div>
  )
}

export function FilesPanel({ sessionId }: FilesPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const isMobile = useIsMobile()
  const { isOpen, close, onFilesLoaded } = useFilesPanelStore()
  const isPanelOpen = isOpen(sessionId)

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
      <Sheet open={isPanelOpen} onOpenChange={(open) => !open && close(sessionId)}>
        <SheetContent side="right" className="w-full p-0 bg-bg-200 [&>button]:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Files</SheetTitle>
          </SheetHeader>
          <FilesPanelContent sessionId={sessionId} onCollapse={() => close(sessionId)} isMobile />
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop: hide completely when closed
  if (!isPanelOpen) {
    return null
  }

  // Desktop: resizable panel
  return (
    <aside
      ref={panelRef}
      className={cn(
        "relative flex flex-col bg-bg-200 border-l-[0.5px] border-border-300",
        isDragging ? "" : "transition-[width] duration-200"
      )}
      style={{ width }}
    >
      <FilesPanelContent sessionId={sessionId} onCollapse={() => close(sessionId)} />

      {/* Resize handle on LEFT side */}
      <div onMouseDown={handleMouseDown} className="absolute top-0 -left-px w-[3px] h-full cursor-col-resize group">
        <div className={cn("w-[2px] h-full mx-auto transition-colors", isDragging ? "bg-primary/50" : "group-hover:bg-primary/30")} />
      </div>
    </aside>
  )
}
