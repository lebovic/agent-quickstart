"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { SessionTransport, type TransportMessage } from "@/lib/websocket/transport"
import { useSessionStore } from "@/lib/stores/session-store"
import { useActivityStore } from "@/lib/stores/activity-store"
import type { SessionEvent, OutboundUserMessage, ControlSubtype, MessageContent, ConnectionState } from "@/lib/types/anthropic_session"

// Stable references for empty arrays to avoid infinite re-renders
const EMPTY_EVENTS: SessionEvent[] = []
const EMPTY_PENDING: OutboundUserMessage[] = []

export function useSessionStream(sessionId: string, initialEvents: SessionEvent[] = []) {
  // Local state for connection (ephemeral)
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Zustand selectors - events persist across navigation
  const liveEvents = useSessionStore((state) => state.liveEvents[sessionId] ?? EMPTY_EVENTS)
  const pendingMessages = useSessionStore((state) => state.pendingMessages[sessionId] ?? EMPTY_PENDING)
  const addPendingMessage = useSessionStore((state) => state.addPendingMessage)

  // Refs
  const transportRef = useRef<SessionTransport | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isInitializedRef = useRef(false)

  // Main connection effect - only depends on sessionId
  useEffect(() => {
    // Cleanup previous connection
    abortRef.current?.abort()
    transportRef.current?.close()

    // Reset connection state (liveEvents persist in Zustand)
    setConnectionState("connecting")
    setError(null)
    setIsInitialized(false)
    isInitializedRef.current = false

    // Create new transport
    const transport = new SessionTransport(sessionId)
    transportRef.current = transport

    const abort = new AbortController()
    abortRef.current = abort

    // Get store actions imperatively (stable references, no re-render dependency)
    const { addLiveEvent, removePendingMessage } = useSessionStore.getState()
    const { setLastActivity } = useActivityStore.getState()

    // Track the initialize request ID to distinguish from other control responses
    let initializeRequestId: string | null = null

    // Process a single message from the transport
    const processMessage = (message: TransportMessage) => {
      // Transport lifecycle events
      if (message.type === "transport_connected") {
        setConnectionState("connected")
        initializeRequestId = crypto.randomUUID()
        transport.send({
          type: "control_request",
          request_id: initializeRequestId,
          request: { subtype: "initialize" },
        })
        return
      }

      if (message.type === "transport_disconnected") {
        setConnectionState("disconnected")
        isInitializedRef.current = false
        setIsInitialized(false)
        return
      }

      if (message.type === "transport_error") {
        setError(message.error)
        setConnectionState("error")
        return
      }

      // Handle control_response - set initialized on success
      // Note: We accept any successful init response, not just our request_id,
      // because React Strict Mode can cause race conditions where the server
      // responds to a previous connection's request first.
      if (message.type === "control_response") {
        const response = message.response

        // Check if this is an initialization success (regardless of request_id)
        const isInitSuccess = response.subtype === "success" || response.error?.includes("Already initialized")

        if (isInitSuccess && !isInitializedRef.current) {
          isInitializedRef.current = true
          setIsInitialized(true)

          // Flush any pending messages that were queued while disconnected
          const pending = useSessionStore.getState().pendingMessages[sessionId] || []
          for (const msg of pending) {
            transport.send(msg)
          }
        } else if (response.subtype === "error" && !response.error?.includes("Already initialized")) {
          setError(response.error || "Request failed")
        }
        return
      }

      // Skip non-renderable events
      if (
        message.type === "keep_alive" ||
        message.type === "env_manager_log" ||
        message.type === "system" ||
        message.type === "tool_progress"
      ) {
        return
      }

      // Renderable events: user, assistant, result
      if (message.type === "user") {
        removePendingMessage(sessionId, message.uuid)
        addLiveEvent(sessionId, message)
        setLastActivity(sessionId)
        return
      }

      if (message.type === "assistant") {
        addLiveEvent(sessionId, message)
        setLastActivity(sessionId)
        return
      }

      if (message.type === "result") {
        addLiveEvent(sessionId, message)
        setLastActivity(sessionId)
        return
      }
    }

    // Start connection
    transport.connect()

    // Process messages from async iterator
    ;(async () => {
      try {
        for await (const message of transport.readMessages()) {
          if (abort.signal.aborted) break
          processMessage(message)
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setConnectionState("error")
        }
      }
    })()

    // Keepalive interval
    const keepalive = setInterval(() => {
      if (transport.isConnected) {
        transport.send({ type: "keep_alive" })
      }
    }, 30000)

    return () => {
      clearInterval(keepalive)
      abort.abort()
      transport.close()
    }
  }, [sessionId])

  // Send a user message
  const sendMessage = useCallback(
    (content: MessageContent) => {
      const uuid = crypto.randomUUID()
      const message: OutboundUserMessage = {
        type: "user",
        uuid,
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: "user", content },
      }

      // Add to Zustand pending messages (session-scoped)
      // Message stays in pending until server echoes it back
      addPendingMessage(sessionId, message)

      // Send immediately if connected and initialized
      const transport = transportRef.current
      if (transport?.isConnected && isInitializedRef.current) {
        transport.send(message)
      }
    },
    [sessionId, addPendingMessage]
  )

  // Send a control message (interrupt, etc.)
  const sendControlMessage = useCallback((subtype: ControlSubtype) => {
    const transport = transportRef.current
    if (transport?.isConnected) {
      transport.send({
        type: "control_request",
        request_id: crypto.randomUUID(),
        request: { subtype },
      })
    }
  }, [])

  // Reconnect function
  const reconnect = useCallback(() => {
    const transport = transportRef.current
    if (transport && !transport.isConnected) {
      setConnectionState("connecting")
      setError(null)
      transport.connect()
    }
  }, [])

  return {
    // Events
    liveEvents,
    pendingMessages,
    initialEvents,
    // Connection
    connectionState,
    error,
    isInitialized,
    // Actions
    sendMessage,
    sendControlMessage,
    reconnect,
  }
}
