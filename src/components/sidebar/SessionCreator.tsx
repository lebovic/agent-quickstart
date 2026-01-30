"use client"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ImageIcon, MoreHorizontal, ArrowUp, Loader2, Cloud, Check, Settings, Plus, PlusCircle, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { ImageBlockParam, TextBlockParam, Base64ImageSource } from "@/lib/types/anthropic_session"
import { EnvironmentDialog } from "./EnvironmentDialog"
import type { Environment } from "@/lib/types/anthropic_session"
import { listEnvironments } from "@/lib/api/anthropic_client"
import { RepoSelector } from "@/components/github"
import { clientConfig } from "@/config.client"
import { usePreferencesStore } from "@/lib/stores/preferences-store"
import { generateBranchName } from "@/lib/executor/git-commands"

type UploadedImage = {
  file: File
  preview: string
  base64: string
  mediaType: Base64ImageSource["media_type"]
}

const MODELS = [
  { value: "claude-opus-4-5-20251101", label: "Opus 4.5", description: "Most capable for complex work" },
  { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", description: "Best for everyday tasks" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5", description: "Fastest for quick answers" },
] as const

export function SessionCreator({ collapsed = false, onExpand }: { collapsed?: boolean; onExpand?: () => void }) {
  const [prompt, setPrompt] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [selectedEnvId, setSelectedEnvId] = useState<string>("")
  const [selectedModel, setSelectedModel] = useState<string>("claude-opus-4-5-20251101")
  const [images, setImages] = useState<UploadedImage[]>([])
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false)
  const [envPopoverOpen, setEnvPopoverOpen] = useState(false)
  const [envDialogOpen, setEnvDialogOpen] = useState(false)
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null)
  const [hoveredEnvId, setHoveredEnvId] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const { lastRepo: selectedRepo, setLastRepo: setSelectedRepo } = usePreferencesStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: envData, isLoading: envsLoading } = useQuery({
    queryKey: ["environments"],
    queryFn: listEnvironments,
  })

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = "auto"
    const maxHeight = 300
    const newHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${newHeight}px`
  }, [prompt])

  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]

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
      newImages.push({
        file,
        preview: dataUrl, // Use data URL directly for preview
        base64,
        mediaType,
      })
    }

    setImages((prev) => [...prev, ...newImages])
    e.target.value = ""
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Auto-select first environment when data loads
  useEffect(() => {
    if (envData?.environments?.length && !selectedEnvId) {
      setSelectedEnvId(envData.environments[0].environment_id)
    }
  }, [envData, selectedEnvId])

  const handleSubmit = async () => {
    if (!prompt.trim() || isCreating || !selectedEnvId) return

    setIsCreating(true)

    try {
      // Build message content - either plain string or array with images
      const messageContent: string | (ImageBlockParam | TextBlockParam)[] =
        images.length > 0
          ? [
              ...images.map(
                (img): ImageBlockParam => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: img.mediaType,
                    data: img.base64,
                  },
                })
              ),
              { type: "text", text: prompt },
            ]
          : prompt

      const response = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "", // Let backend generate LLM title
          environment_id: selectedEnvId,
          session_context: {
            sources:
              gitIntegrationEnabled && selectedRepo
                ? [
                    {
                      type: "git_repository",
                      url: `https://github.com/${selectedRepo.owner}/${selectedRepo.repo}`,
                    },
                  ]
                : [],
            outcomes:
              gitIntegrationEnabled && selectedRepo
                ? [
                    {
                      type: "git_repository",
                      git_info: {
                        type: "github",
                        repo: `${selectedRepo.owner}/${selectedRepo.repo}`,
                        branches: [generateBranchName()],
                      },
                    },
                  ]
                : [],
            model: selectedModel,
          },
          events: [
            {
              type: "event",
              data: {
                uuid: crypto.randomUUID(),
                session_id: "",
                type: "user",
                parent_tool_use_id: null,
                message: {
                  role: "user",
                  content: messageContent,
                },
              },
            },
          ],
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create session: ${errorText}`)
      }

      const session = await response.json()

      queryClient.invalidateQueries({ queryKey: ["sessions"] })
      setPrompt("")
      setImages([])
      router.push(`/code/${session.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create session")
    } finally {
      setIsCreating(false)
    }
  }

  const handleEnvSelect = (envId: string) => {
    setSelectedEnvId(envId)
    setEnvPopoverOpen(false)
  }

  const handleEditEnv = (env: Environment, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingEnv(env)
    setEnvPopoverOpen(false)
    setEnvDialogOpen(true)
  }

  const handleAddEnv = () => {
    setEditingEnv(null)
    setEnvPopoverOpen(false)
    setEnvDialogOpen(true)
  }

  const gitIntegrationEnabled = clientConfig.gitIntegrationMode !== "disabled"
  const gitIntegrationRequired = clientConfig.gitIntegrationMode === "required"
  const hasRequiredRepo = !gitIntegrationRequired || !!selectedRepo
  const canSubmit = prompt.trim().length > 0 && !isCreating && !!selectedEnvId && hasRequiredRepo
  const selectedEnv = envData?.environments.find((e) => e.environment_id === selectedEnvId)

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-text-400 hover:text-text-100 hover:bg-bg-300" onClick={onExpand}>
            <PlusCircle className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">New session</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="p-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={handleImageSelect}
        className="hidden"
      />
      <div className="group relative rounded-lg border-[0.5px] border-border-300 transition-all cursor-text bg-bg-000/60 focus-within:bg-bg-000">
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

        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find something hacky and clean it up"
          disabled={isCreating}
          className="text-sm font-book w-full pt-3 px-3 bg-transparent border-0 resize-none text-text-000 placeholder-text-500 disabled:opacity-50 disabled:cursor-not-allowed overflow-auto focus:outline-none min-h-[66px] max-h-[300px]"
          rows={2}
        />

        {/* Action bar */}
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="p-1.5 rounded-md text-text-300 hover:text-text-100 hover:bg-bg-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition duration-300"
                  disabled={isCreating}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach image</TooltipContent>
            </Tooltip>

            <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="p-1.5 rounded-md text-text-300 hover:text-text-100 hover:bg-bg-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition duration-300"
                      disabled={isCreating}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Select model</TooltipContent>
              </Tooltip>
              <PopoverContent className="w-64 p-1" align="start">
                {MODELS.map((model) => (
                  <Button
                    key={model.value}
                    variant="ghost"
                    onClick={() => {
                      setSelectedModel(model.value)
                      setModelPopoverOpen(false)
                    }}
                    className="w-full justify-between px-2 py-1.5 h-auto font-normal"
                  >
                    <div className="flex flex-col items-start">
                      <span>{model.label}</span>
                      <span className="text-xs text-text-500">{model.description}</span>
                    </div>
                    <div className="size-4 flex items-center justify-center shrink-0">
                      {selectedModel === model.value && <Check className="size-4 text-accent-main-100" />}
                    </div>
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                size="icon-sm"
                className={`h-6 w-6 rounded-md ${canSubmit ? "bg-accent-main-100 hover:bg-accent-main-200" : "bg-accent-main-100/70"}`}
              >
                {isCreating ? <Loader2 className="size-4 animate-spin text-white" /> : <ArrowUp className="size-4 text-white" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create session (Enter)</TooltipContent>
          </Tooltip>
        </div>

        <div className="h-px bg-border-300 mx-0 mb-1" />

        {/* Repo and environment selectors */}
        <div className="flex items-center gap-1 px-2 pb-1">
          {gitIntegrationEnabled && (
            <>
              <RepoSelector value={selectedRepo} onChange={setSelectedRepo} disabled={isCreating} />
              <div className="h-5 w-px bg-border-300" />
            </>
          )}

          <Popover open={envPopoverOpen} onOpenChange={setEnvPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className="group flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-300 hover:text-text-100 hover:bg-bg-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-0 flex-1"
                disabled={isCreating || envsLoading}
              >
                <Cloud className="size-4" />
                <span className="truncate">{envsLoading ? "Loading..." : selectedEnv?.name || "Environment"}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="end">
              <div className="space-y-0.5">
                {envData?.environments.map((env) => (
                  <Button
                    key={env.environment_id}
                    variant="ghost"
                    onClick={() => handleEnvSelect(env.environment_id)}
                    onMouseEnter={() => setHoveredEnvId(env.environment_id)}
                    onMouseLeave={() => setHoveredEnvId(null)}
                    className="w-full justify-between px-2 py-1.5 h-auto font-normal"
                  >
                    <div className="flex items-center gap-2">
                      <Cloud className="size-4 text-text-500" />
                      <span>{env.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {hoveredEnvId === env.environment_id && (
                        <div role="button" onClick={(e) => handleEditEnv(env, e)} className="p-0.5 rounded hover:bg-bg-200">
                          <Settings className="size-4 text-text-500" />
                        </div>
                      )}
                      {selectedEnvId === env.environment_id && <Check className="size-4 text-accent-main-100" />}
                    </div>
                  </Button>
                ))}
              </div>
              <Separator className="my-1" />
              <Button
                variant="ghost"
                onClick={handleAddEnv}
                className="w-full justify-start gap-2 px-2 py-1.5 h-auto font-normal text-text-500"
              >
                <Plus className="size-4" />
                <span>Add environment</span>
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <EnvironmentDialog open={envDialogOpen} onOpenChange={setEnvDialogOpen} environment={editingEnv} onCreated={setSelectedEnvId} />

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
