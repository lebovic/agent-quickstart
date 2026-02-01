import { create } from "zustand"
import { persist } from "zustand/middleware"

type FilesPanelStore = {
  openSessions: Record<string, boolean>
  lastFileCounts: Record<string, number>
  hasAutoOpened: Record<string, boolean>
  isOpen: (sessionId: string) => boolean
  open: (sessionId: string) => void
  close: (sessionId: string) => void
  toggle: (sessionId: string) => void
  onFilesLoaded: (sessionId: string, fileCount: number) => void
}

export const useFilesPanelStore = create<FilesPanelStore>()(
  persist(
    (set, get) => ({
      openSessions: {},
      lastFileCounts: {},
      hasAutoOpened: {},
      isOpen: (sessionId) => get().openSessions[sessionId] ?? false,
      open: (sessionId) =>
        set((state) => ({
          openSessions: { ...state.openSessions, [sessionId]: true },
        })),
      close: (sessionId) =>
        set((state) => ({
          openSessions: { ...state.openSessions, [sessionId]: false },
        })),
      toggle: (sessionId) =>
        set((state) => ({
          openSessions: { ...state.openSessions, [sessionId]: !state.openSessions[sessionId] },
        })),
      onFilesLoaded: (sessionId, fileCount) => {
        const { lastFileCounts, hasAutoOpened, openSessions } = get()
        const prevCount = lastFileCounts[sessionId] ?? 0
        const isCurrentlyOpen = openSessions[sessionId] ?? false

        if (prevCount === 0 && fileCount > 0 && !hasAutoOpened[sessionId] && !isCurrentlyOpen) {
          set({
            openSessions: { ...openSessions, [sessionId]: true },
            lastFileCounts: { ...lastFileCounts, [sessionId]: fileCount },
            hasAutoOpened: { ...hasAutoOpened, [sessionId]: true },
          })
        } else {
          set({ lastFileCounts: { ...lastFileCounts, [sessionId]: fileCount } })
        }
      },
    }),
    {
      name: "files-panel-store",
      partialize: (state) => ({ openSessions: state.openSessions }),
    }
  )
)
