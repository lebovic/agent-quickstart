import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { SessionEvent, OutboundUserMessage } from "@/lib/types/anthropic_session"

type SessionStore = {
  // Live events per session (received via WebSocket, not persisted)
  liveEvents: Record<string, SessionEvent[]>

  // Pending messages per session (persisted)
  pendingMessages: Record<string, OutboundUserMessage[]>

  // Actions for live events
  addLiveEvent: (sessionId: string, event: SessionEvent) => void
  clearLiveEvents: (sessionId: string) => void

  // Actions for pending messages
  addPendingMessage: (sessionId: string, message: OutboundUserMessage) => void
  removePendingMessage: (sessionId: string, uuid: string) => void
  clearPendingMessages: (sessionId: string) => void
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      liveEvents: {},
      pendingMessages: {},

      addLiveEvent: (sessionId, event) => {
        set((state) => {
          const current = state.liveEvents[sessionId] || []
          // Dedupe by UUID
          const uuid = "uuid" in event ? event.uuid : null
          if (uuid && current.some((e) => "uuid" in e && e.uuid === uuid)) {
            return state
          }
          return {
            liveEvents: {
              ...state.liveEvents,
              [sessionId]: [...current, event],
            },
          }
        })
      },

      clearLiveEvents: (sessionId) => {
        set((state) => {
          if (!state.liveEvents[sessionId]?.length) return state
          return {
            liveEvents: {
              ...state.liveEvents,
              [sessionId]: [],
            },
          }
        })
      },

      addPendingMessage: (sessionId, message) => {
        set((state) => ({
          pendingMessages: {
            ...state.pendingMessages,
            [sessionId]: [...(state.pendingMessages[sessionId] || []), message],
          },
        }))
      },

      removePendingMessage: (sessionId, uuid) => {
        set((state) => {
          const current = state.pendingMessages[sessionId] || []
          const filtered = current.filter((m) => m.uuid !== uuid)
          if (filtered.length === current.length) return state
          return {
            pendingMessages: {
              ...state.pendingMessages,
              [sessionId]: filtered,
            },
          }
        })
      },

      clearPendingMessages: (sessionId) => {
        set((state) => {
          if (!state.pendingMessages[sessionId]?.length) return state
          return {
            pendingMessages: {
              ...state.pendingMessages,
              [sessionId]: [],
            },
          }
        })
      },
    }),
    {
      name: "session-pending-messages",
      // Only persist pendingMessages, not liveEvents
      partialize: (state) => ({ pendingMessages: state.pendingMessages }),
    }
  )
)
