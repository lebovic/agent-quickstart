"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Environment, EnvironmentConfig } from "@/lib/types/anthropic_session"
import { createEnvironment, updateEnvironment } from "@/lib/api/anthropic_client"
import { usePreferencesStore } from "@/lib/stores/preferences-store"

const NETWORK_ACCESS_OPTIONS = ["none", "trusted", "full"] as const
type NetworkAccess = (typeof NETWORK_ACCESS_OPTIONS)[number]

function isNetworkAccess(value: string): value is NetworkAccess {
  return NETWORK_ACCESS_OPTIONS.includes(value as NetworkAccess)
}

const NETWORK_CONFIGS: Record<NetworkAccess, EnvironmentConfig["network_config"]> = {
  none: { allowed_hosts: [], allow_default_hosts: false },
  trusted: { allowed_hosts: [], allow_default_hosts: true },
  full: { allowed_hosts: ["*"], allow_default_hosts: true },
}

function parseEnvVars(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq > 0) result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return result
}

function formatEnvVars(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
}

function _getNetworkAccess(config: EnvironmentConfig | null): NetworkAccess {
  if (!config?.network_config) return "trusted"
  const { allowed_hosts, allow_default_hosts } = config.network_config
  if (allowed_hosts.includes("*")) return "full"
  return allow_default_hosts ? "trusted" : "none"
}

type EnvironmentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  environment: Environment | null
  onCreated?: (environmentId: string) => void
}

export function EnvironmentDialog({ open, onOpenChange, environment, onCreated }: EnvironmentDialogProps) {
  const queryClient = useQueryClient()

  // Use key to reset form state when environment changes
  const formKey = environment?.environment_id ?? "new"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <EnvironmentForm
          key={formKey}
          environment={environment}
          onClose={() => onOpenChange(false)}
          onSuccess={(newEnvId) => {
            queryClient.invalidateQueries({ queryKey: ["environments"] })
            if (newEnvId) onCreated?.(newEnvId)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

type EnvironmentFormProps = {
  environment: Environment | null
  onClose: () => void
  onSuccess: (newEnvironmentId?: string) => void
}

function EnvironmentForm({ environment, onClose, onSuccess }: EnvironmentFormProps) {
  const isEditing = !!environment
  const existingConfig = environment?.config
  const { provider } = usePreferencesStore()
  const useSelfHosted = provider !== "debug"

  const [name, setName] = useState(environment?.name ?? "")
  const [networkAccess, setNetworkAccess] = useState<NetworkAccess>("full")
  const [envVars, setEnvVars] = useState(existingConfig?.environment ? formatEnvVars(existingConfig.environment) : "")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const _handleNetworkAccessChange = (value: string) => {
    if (isNetworkAccess(value)) {
      setNetworkAccess(value)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) return

    setIsSubmitting(true)

    try {
      const envRecord = parseEnvVars(envVars)
      const networkConfig = NETWORK_CONFIGS[networkAccess]

      if (isEditing && environment && existingConfig) {
        await updateEnvironment(environment.environment_id, {
          name: name.trim(),
          description: "",
          config: {
            ...existingConfig,
            environment: envRecord,
            network_config: networkConfig,
          },
        })
        onSuccess()
      } else {
        const newEnv = await createEnvironment({
          name: name.trim(),
          kind: useSelfHosted ? "local" : "anthropic_cloud",
          description: "",
          config: {
            environment_type: useSelfHosted ? "local" : "anthropic",
            cwd: "/home/user",
            init_script: null,
            environment: envRecord,
            languages: [
              { name: "python", version: "3.11" },
              { name: "node", version: "20" },
            ],
            network_config: networkConfig,
          },
        })
        onSuccess(newEnv.environment_id)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save environment")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Update cloud environment" : "New cloud environment"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2">
        {/* Name field */}
        <div className="space-y-2">
          <Label htmlFor="env-name">Name</Label>
          <Input id="env-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Default" />
        </div>

        {/* Network access */}
        <div className="space-y-2">
          <Label htmlFor="network-access">Network access</Label>
          <Select value="full" disabled>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Environment variables */}
        <div className="space-y-2">
          <Label htmlFor="env-vars">Environment variables</Label>
          <Textarea
            id="env-vars"
            value={envVars}
            onChange={(e) => setEnvVars(e.target.value)}
            placeholder={`SECRET_KEY=sk_abc123

GCP_CREDENTIALS="{
  \\"type\\": \\"service_account\\",
  \\"project_id\\": \\"my-project\\"
}"`}
            className="font-mono text-sm min-h-[120px]"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || !name.trim()}>
          {isSubmitting ? "Saving..." : isEditing ? "Save changes" : "Create environment"}
        </Button>
      </div>
    </>
  )
}
