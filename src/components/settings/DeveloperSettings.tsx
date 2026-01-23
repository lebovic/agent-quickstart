"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Provider } from "@prisma/client"
import { useQueryClient } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MaskedInput } from "@/components/ui/masked-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type SettingsResponse } from "@/lib/schemas/settings"

export function DeveloperSettings() {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [provider, setProvider] = useState<Provider>(Provider.hosted)
  const [anthropicApiKey, setAnthropicApiKey] = useState("")
  const [anthropicApiKeyEdited, setAnthropicApiKeyEdited] = useState(false)
  const [anthropicSessionKey, setAnthropicSessionKey] = useState("")
  const [anthropicSessionKeyEdited, setAnthropicSessionKeyEdited] = useState(false)
  const [anthropicOrgUuid, setAnthropicOrgUuid] = useState("")

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: SettingsResponse) => {
        setSettings(data)
        setProvider(data.provider)
        setAnthropicOrgUuid(data.anthropicOrgUuid ?? "")
        setLoading(false)
      })
  }, [])

  const providerChanged = settings !== null && provider !== settings.provider
  const byokChanged = anthropicApiKeyEdited
  const debugChanged = settings !== null && (anthropicSessionKeyEdited || anthropicOrgUuid !== (settings.anthropicOrgUuid ?? ""))

  async function save(section: string, body: Record<string, string>, onSuccess?: () => void) {
    setSaving(section)
    setError(null)
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      const detail = data?.error?.message
      setError(detail ? `Failed to save settings: ${detail}` : "Failed to save settings")
      setSaving(null)
      return
    }
    setSettings(data)
    onSuccess?.()
    setSaving(null)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-text-100">Developer settings</h2>
        <div className="h-32 animate-pulse rounded bg-bg-300" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-text-100">Developer settings</h2>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={Provider.hosted}>Hosted</SelectItem>
              <SelectItem value={Provider.byok}>BYOK</SelectItem>
              <SelectItem value={Provider.debug}>Debug</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {providerChanged && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setProvider(settings!.provider)} disabled={saving === "provider"}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                save("provider", { provider }, () => {
                  queryClient.invalidateQueries({ queryKey: ["settings"] })
                  queryClient.invalidateQueries({ queryKey: ["sessions"] })
                  queryClient.invalidateQueries({ queryKey: ["environments"] })
                  queryClient.invalidateQueries({ queryKey: ["github"] })
                })
              }
              disabled={saving === "provider"}
            >
              {saving === "provider" ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-6 space-y-4">
        <h3 className="text-base font-medium text-text-100">BYOK</h3>
        <div className="space-y-2">
          <Label>Anthropic API Key</Label>
          <MaskedInput
            displayValue={settings?.anthropicApiKeyMasked ?? undefined}
            placeholder="sk-ant-api03-..."
            value={anthropicApiKey}
            onValueChange={setAnthropicApiKey}
            editing={anthropicApiKeyEdited}
            onEditingChange={setAnthropicApiKeyEdited}
          />
        </div>
        {byokChanged && (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAnthropicApiKey("")
                setAnthropicApiKeyEdited(false)
              }}
              disabled={saving === "byok"}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                save("byok", { anthropicApiKey }, () => {
                  setAnthropicApiKey("")
                  setAnthropicApiKeyEdited(false)
                })
              }
              disabled={saving === "byok"}
            >
              {saving === "byok" ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-6 space-y-4">
        <h3 className="text-base font-medium text-text-100">Debug</h3>
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertTitle>Debug only</AlertTitle>
          <AlertDescription>
            Session keys are a dangerous authentication method. Only use this for debugging Anthropic API interoperability.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label>Session Key</Label>
          <MaskedInput
            displayValue={settings?.anthropicSessionKeyMasked ?? undefined}
            placeholder="sk-ant-sid01-..."
            value={anthropicSessionKey}
            onValueChange={setAnthropicSessionKey}
            editing={anthropicSessionKeyEdited}
            onEditingChange={setAnthropicSessionKeyEdited}
          />
        </div>

        <div className="space-y-2">
          <Label>Organization UUID</Label>
          <Input
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={anthropicOrgUuid}
            onChange={(e) => setAnthropicOrgUuid(e.target.value)}
          />
        </div>
        {debugChanged && (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAnthropicSessionKey("")
                setAnthropicSessionKeyEdited(false)
                setAnthropicOrgUuid(settings?.anthropicOrgUuid ?? "")
              }}
              disabled={saving === "debug"}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                save(
                  "debug",
                  {
                    ...(anthropicSessionKeyEdited && { anthropicSessionKey }),
                    anthropicOrgUuid,
                  },
                  () => {
                    setAnthropicSessionKey("")
                    setAnthropicSessionKeyEdited(false)
                  }
                )
              }
              disabled={saving === "debug"}
            >
              {saving === "debug" ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
