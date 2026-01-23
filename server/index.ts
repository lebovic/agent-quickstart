import { createServer } from "http"
import { parse } from "url"
import next from "next"
import { WebSocketServer } from "ws"
import { log } from "../src/lib/logger"
import { config } from "../src/config"
import { getSessionManager } from "./websocket/session-manager"
import { handleClientConnection } from "./websocket/client-handler"
import { handleIngressConnection } from "./websocket/ingress-handler"
import { sessionIdToUuid } from "../src/lib/id"
import { startCleanupJob as startDockerCleanupJob, stopCleanupJob as stopDockerCleanupJob } from "../src/lib/executor/docker"
import { startCleanupJob as startModalCleanupJob, stopCleanupJob as stopModalCleanupJob } from "../src/lib/executor/modal"

function isOriginAllowed(origin: string | undefined): boolean {
  if (config.allowedWsOrigins.length === 0) return true
  if (!origin) return false
  return config.allowedWsOrigins.includes(origin)
}

const dev = process.env.NODE_ENV !== "production"
const hostname = "localhost"
const port = parseInt(process.env.PORT || "3000", 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

const CLIENT_WS_PATTERN = /^\/ws\/sessions\/([^/]+)$/
const INGRESS_WS_PATTERN = /^\/v1\/session_ingress\/ws\/([^/]+)$/

app.prepare().then(async () => {
  const manager = await getSessionManager()
  const nextUpgradeHandler = app.getUpgradeHandler()

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!)

    const clientMatch = pathname?.match(CLIENT_WS_PATTERN)
    const ingressMatch = pathname?.match(INGRESS_WS_PATTERN)

    if (clientMatch) {
      const origin = req.headers.origin
      if (!isOriginAllowed(origin)) {
        log.warn({ origin }, "WebSocket connection rejected: origin not allowed")
        socket.destroy()
        return
      }

      const taggedSessionId = clientMatch[1]
      let sessionUuid: string | null = null

      try {
        sessionUuid = sessionIdToUuid(taggedSessionId)
      } catch {
        // Invalid format - might be an external session ID for debug mode
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleClientConnection(taggedSessionId, sessionUuid, ws, req)
      })
    } else if (ingressMatch) {
      const taggedSessionId = ingressMatch[1]
      log.info({ taggedSessionId, url: req.url }, "Ingress WebSocket connection attempt")
      let sessionUuid: string

      try {
        sessionUuid = sessionIdToUuid(taggedSessionId)
        log.info({ taggedSessionId, sessionUuid }, "Converted session ID to UUID")
      } catch (err) {
        log.error({ taggedSessionId, err: (err as Error).message }, "Failed to convert session ID")
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleIngressConnection(sessionUuid, ws, req)
      })
    } else if (pathname?.startsWith("/_next/")) {
      // Let Next.js handle its own WebSocket connections (HMR, etc.)
      // Removing this breaks dev mode
      nextUpgradeHandler(req, socket, head)
    } else {
      socket.destroy()
    }
  })

  const shutdown = async () => {
    log.info("Shutting down server")
    stopDockerCleanupJob()
    stopModalCleanupJob()
    await manager.shutdown()
    server.close()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Start executor cleanup jobs
  startDockerCleanupJob()
  startModalCleanupJob()

  server.listen(port, () => {
    log.info({ hostname, port }, "Server ready")
  })
})
