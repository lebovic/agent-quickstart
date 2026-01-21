import { create } from "zustand"

type ActivityStore = {
  // Per-session activity timestamps
  lastActivityTime: Record<string, number>

  // Current time updated by global interval (avoids Date.now() in render)
  currentTime: number

  // Set activity timestamp for a session
  setLastActivity: (sessionId: string, time?: number) => void
}

export const useActivityStore = create<ActivityStore>()((set) => ({
  lastActivityTime: {},
  currentTime: Date.now(),

  setLastActivity: (sessionId, time) => {
    const timestamp = time ?? Date.now()
    set((state) => ({
      lastActivityTime: {
        ...state.lastActivityTime,
        [sessionId]: timestamp,
      },
    }))
  },
}))

export const ACTIVITY_TIMEOUT = 5_000

// Auto-start the global clock when module is imported
if (typeof window !== "undefined") {
  setInterval(() => {
    useActivityStore.setState({ currentTime: Date.now() })
  }, ACTIVITY_TIMEOUT)
}
