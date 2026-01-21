import type { SessionEvent, OutboundMessage } from "@/lib/types/anthropic_session"

// Lifecycle events - types chosen to not conflict with SessionEvent.type values
type ConnectedEvent = { type: "transport_connected" }
type DisconnectedEvent = { type: "transport_disconnected"; code: number; reason: string }
type ErrorEvent = { type: "transport_error"; error: string }

export type LifecycleEvent = ConnectedEvent | DisconnectedEvent | ErrorEvent
export type TransportMessage = SessionEvent | LifecycleEvent

/**
 * WebSocket transport layer for session communication.
 * Handles connection lifecycle and exposes an async iterator for message consumption.
 * Has no knowledge of React or state management.
 */
export class SessionTransport {
  private ws: WebSocket | null = null
  private messageQueue: TransportMessage[] = []
  private resolveWaiting: (() => void) | null = null
  private closed = false
  private readonly sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (this.ws || this.closed) return

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${protocol}//${window.location.host}/ws/sessions/${this.sessionId}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.enqueue({ type: "transport_connected" })
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SessionEvent
        this.enqueue(data)
      } catch {
        // Ignore malformed messages
      }
    }

    this.ws.onclose = (event) => {
      this.enqueue({
        type: "transport_disconnected",
        code: event.code,
        reason: event.reason,
      })
      this.ws = null
    }

    this.ws.onerror = () => {
      this.enqueue({ type: "transport_error", error: "WebSocket error" })
    }
  }

  send(message: OutboundMessage | { type: "keep_alive" }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  close(): void {
    this.closed = true
    if (this.ws) {
      this.ws.close(1000, "Client closed")
      this.ws = null
    }
    // Resolve any waiting iterator to allow cleanup
    this.resolveWaiting?.()
    this.resolveWaiting = null
  }

  private enqueue(message: TransportMessage): void {
    this.messageQueue.push(message)
    this.resolveWaiting?.()
    this.resolveWaiting = null
  }

  async *readMessages(): AsyncGenerator<TransportMessage> {
    while (!this.closed) {
      while (this.messageQueue.length > 0) {
        yield this.messageQueue.shift()!
      }

      if (this.closed) break

      // Wait for next message
      await new Promise<void>((resolve) => {
        this.resolveWaiting = resolve
      })
    }
  }
}
