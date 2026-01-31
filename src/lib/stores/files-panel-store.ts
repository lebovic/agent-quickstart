import { create } from "zustand"

type FilesPanelStore = {
  isOpen: boolean
  lastFileCounts: Record<string, number>
  hasAutoOpened: Record<string, boolean>
  open: () => void
  close: () => void
  toggle: () => void
  onFilesLoaded: (sessionId: string, fileCount: number) => void
}

export const useFilesPanelStore = create<FilesPanelStore>((set, get) => ({
  isOpen: false,
  lastFileCounts: {},
  hasAutoOpened: {},
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  onFilesLoaded: (sessionId, fileCount) => {
    const { lastFileCounts, hasAutoOpened, isOpen } = get()
    const prevCount = lastFileCounts[sessionId] ?? 0

    if (prevCount === 0 && fileCount > 0 && !hasAutoOpened[sessionId] && !isOpen) {
      set({
        isOpen: true,
        lastFileCounts: { ...lastFileCounts, [sessionId]: fileCount },
        hasAutoOpened: { ...hasAutoOpened, [sessionId]: true },
      })
    } else {
      set({ lastFileCounts: { ...lastFileCounts, [sessionId]: fileCount } })
    }
  },
}))
