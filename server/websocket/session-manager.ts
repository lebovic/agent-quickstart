import { WebSocket } from "ws"
import { Client } from "pg"
import { config } from "../../src/config"
import { prisma } from "../../src/lib/db"
import { log } from "../../src/lib/logger"

type Session = {
  subscribers: Set<WebSocket>
  ingress: WebSocket | null
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private pgClient: Client
  private isConnected = false
  private channelToSession = new Map<string, string>()

  constructor() {
    this.pgClient = new Client({ connectionString: config.databaseUrl })

    this.pgClient.on("error", (err) => {
      log.error({ err: err.message }, "WebSocket pub/sub Postgres connection error")
    })

    this.pgClient.on("notification", (msg) => {
      this.handleNotification(msg.channel, msg.payload)
    })
  }

  async connect(): Promise<void> {
    if (this.isConnected) return

    await this.pgClient.connect()
    this.isConnected = true
    log.info("WebSocket pub/sub Postgres connection established")
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      for (const ws of session.subscribers) {
        ws.close(1001, "Server shutting down")
      }
      session.ingress?.close(1001, "Server shutting down")
    }
    this.sessions.clear()
    this.channelToSession.clear()

    await this.pgClient.end()
    this.isConnected = false
    log.info("WebSocket pub/sub Postgres connection closed")
  }

  async addSubscriber(sessionId: string, ws: WebSocket): Promise<string | null> {
    const session = this.getOrCreate(sessionId)

    if (session.subscribers.size >= 3) {
      return "Too many subscribers"
    }

    const wasEmpty = session.subscribers.size === 0
    session.subscribers.add(ws)

    if (wasEmpty) {
      await this.listenToChannel(sessionId)
    }

    return null
  }

  async removeSubscriber(sessionId: string, ws: WebSocket): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.subscribers.delete(ws)

    if (session.subscribers.size === 0) {
      await this.unlistenFromChannel(sessionId)
    }

    this.cleanupIfEmpty(sessionId)
  }

  setIngress(sessionId: string, ws: WebSocket): string | null {
    const session = this.getOrCreate(sessionId)

    if (session.ingress) {
      if (session.ingress.readyState === WebSocket.OPEN) {
        log.debug({ sessionId }, "Replacing existing ingress connection")
        session.ingress.close(1000, "Replaced by new connection")
      }
      session.ingress = null
    }

    session.ingress = ws
    return null
  }

  removeIngress(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.ingress = null
      this.cleanupIfEmpty(sessionId)
    }
  }

  hasIngress(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    return session?.ingress?.readyState === WebSocket.OPEN
  }

  async notify(sessionId: string, eventId: string): Promise<void> {
    const channel = this.sessionIdToChannel(sessionId)
    await this.pgClient.query("SELECT pg_notify($1, $2)", [channel, eventId])
  }

  sendToIngress(sessionId: string, message: string): string | null {
    const session = this.sessions.get(sessionId)
    if (!session) {
      log.debug({ sessionId }, "sendToIngress: session not found in map")
      return "Session not found"
    }

    if (!session.ingress) {
      log.debug({ sessionId }, "sendToIngress: no ingress WebSocket")
      return "Ingress not connected"
    }

    if (session.ingress.readyState !== WebSocket.OPEN) {
      log.debug({ sessionId, readyState: session.ingress.readyState }, "sendToIngress: ingress not OPEN")
      return "Ingress not connected"
    }

    session.ingress.send(message + "\n")
    return null
  }

  broadcastToSubscribers(sessionId: string, message: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const payload = JSON.stringify(message)
    for (const ws of session.subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  getAllConnections(): WebSocket[] {
    const connections: WebSocket[] = []
    for (const session of this.sessions.values()) {
      connections.push(...session.subscribers)
      if (session.ingress) connections.push(session.ingress)
    }
    return connections
  }

  private getOrCreate(sessionId: string): Session {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = { subscribers: new Set(), ingress: null }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  private sessionIdToChannel(sessionId: string): string {
    return `session_${sessionId.replace(/-/g, "")}`
  }

  private async listenToChannel(sessionId: string): Promise<void> {
    const channel = this.sessionIdToChannel(sessionId)
    this.channelToSession.set(channel, sessionId)
    await this.pgClient.query(`LISTEN ${channel}`)
  }

  private async unlistenFromChannel(sessionId: string): Promise<void> {
    const channel = this.sessionIdToChannel(sessionId)
    this.channelToSession.delete(channel)
    await this.pgClient.query(`UNLISTEN ${channel}`)
  }

  private handleNotification(channel: string, eventId: string | undefined): void {
    if (!eventId) return

    const sessionId = this.channelToSession.get(channel)
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!session) return

    this.fetchAndBroadcast(sessionId, eventId)
  }

  private async fetchAndBroadcast(sessionId: string, eventId: string): Promise<void> {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { data: true },
    })

    if (!event) return

    const payload = JSON.stringify(event.data)
    const session = this.sessions.get(sessionId)
    if (!session) return

    for (const ws of session.subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  private cleanupIfEmpty(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session && session.subscribers.size === 0 && !session.ingress) {
      this.sessions.delete(sessionId)
    }
  }
}

let sessionManager: SessionManager | null = null

export async function getSessionManager(): Promise<SessionManager> {
  if (!sessionManager) {
    sessionManager = new SessionManager()
    await sessionManager.connect()
  }
  return sessionManager
}
