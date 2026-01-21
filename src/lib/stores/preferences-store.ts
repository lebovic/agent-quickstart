import { useCallback, useMemo, useSyncExternalStore } from "react"
import { useSession } from "@/lib/auth/auth-client"
import { useQuery } from "@tanstack/react-query"
import type { SettingsResponse } from "@/lib/schemas/settings"

type RepoSelection = {
  owner: string
  repo: string
  default_branch: string
}

type Preferences = {
  lastRepo: RepoSelection | null
}

function getStorageKey(userId: string, provider: string) {
  // hosted and byok share the same GitHub integration, debug uses Anthropic's
  const mode = provider === "debug" ? "debug" : "local"
  return `agent-quickstart:preferences:${userId}:${mode}`
}

// Simple pub/sub for same-tab localStorage updates
const listeners = new Map<string, Set<() => void>>()

function subscribe(key: string, callback: () => void) {
  if (!listeners.has(key)) {
    listeners.set(key, new Set())
  }
  listeners.get(key)!.add(callback)

  // Also listen for cross-tab storage events
  const handleStorage = (e: StorageEvent) => {
    if (e.key === key) callback()
  }
  window.addEventListener("storage", handleStorage)

  return () => {
    listeners.get(key)?.delete(callback)
    window.removeEventListener("storage", handleStorage)
  }
}

function notifyListeners(key: string) {
  listeners.get(key)?.forEach((cb) => cb())
}

function getSnapshot(key: string): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(key)
}

function setItem(key: string, value: string) {
  localStorage.setItem(key, value)
  notifyListeners(key)
}

export function usePreferencesStore() {
  const { data: session } = useSession()
  const userId = session?.user?.id

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings")
      return res.json() as Promise<SettingsResponse>
    },
    enabled: !!userId,
  })

  const provider = settings?.provider
  const storageKey = userId && provider ? getStorageKey(userId, provider) : null

  const subscribeToKey = useCallback(
    (callback: () => void) => {
      if (!storageKey) return () => {}
      return subscribe(storageKey, callback)
    },
    [storageKey]
  )

  const getSnapshotForKey = useCallback(() => {
    if (!storageKey) return null
    return getSnapshot(storageKey)
  }, [storageKey])

  const getServerSnapshot = useCallback(() => null, [])

  const storedValue = useSyncExternalStore(subscribeToKey, getSnapshotForKey, getServerSnapshot)

  const lastRepo = useMemo(() => {
    if (!storedValue) return null
    try {
      return (JSON.parse(storedValue) as Preferences).lastRepo
    } catch {
      return null
    }
  }, [storedValue])

  const setLastRepo = useCallback(
    (repo: RepoSelection | null) => {
      if (!storageKey) return
      setItem(storageKey, JSON.stringify({ lastRepo: repo }))
    },
    [storageKey]
  )

  return {
    lastRepo,
    setLastRepo,
    provider: settings?.provider ?? null,
  }
}
