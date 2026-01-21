import { WebSocket, type RawData } from "ws"
import { log } from "../../src/lib/logger"

const ANTHROPIC_WS_URL = "wss://api.anthropic.com"

/**
 * Raw WebSocket proxy to Anthropic for debug mode sessions.
 * Just relays bytes between client and Anthropic with credentials.
 */
export function proxyToAnthropicWebSocket(
  taggedSessionId: string,
  ws: WebSocket,
  sessionKey: string,
  orgUuid: string,
  bufferedMessages: RawData[] = []
): void {
  const anthropicWsUrl = `${ANTHROPIC_WS_URL}/v1/sessions/ws/${taggedSessionId}/subscribe?organization_uuid=${orgUuid}`

  log.info({ taggedSessionId, url: anthropicWsUrl }, "Proxying WebSocket to Anthropic")

  const anthropicWs = new WebSocket(anthropicWsUrl, {
    headers: {
      Cookie: `sessionKey=${sessionKey}`,
    },
  })

  // Buffer messages until Anthropic connection is ready
  const pendingMessages: { data: RawData; isBinary: boolean }[] = []
  let anthropicReady = false

  // When Anthropic connection opens, flush any buffered messages
  anthropicWs.on("open", () => {
    anthropicReady = true

    // Forward messages that arrived before we connected to Anthropic
    // These are JSON messages buffered during client-handler setup, send as text
    for (const data of bufferedMessages) {
      anthropicWs.send(data.toString(), { binary: false })
    }

    // Forward messages that arrived after handoff but before Anthropic was ready
    for (const { data, isBinary } of pendingMessages) {
      anthropicWs.send(data, { binary: isBinary })
    }
    pendingMessages.length = 0
  })

  // Relay: Anthropic → Client
  anthropicWs.on("message", (data, isBinary) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: isBinary })
    }
  })

  // Relay: Client → Anthropic (with buffering if not yet connected)
  ws.on("message", (data, isBinary) => {
    if (anthropicReady && anthropicWs.readyState === WebSocket.OPEN) {
      anthropicWs.send(data, { binary: isBinary })
    } else {
      pendingMessages.push({ data, isBinary })
    }
  })

  // Close propagation
  anthropicWs.on("close", (code, reason) => {
    ws.close(code, reason?.toString())
  })

  ws.on("close", (code, reason) => {
    anthropicWs.close(code, reason?.toString())
  })

  // Error handling
  anthropicWs.on("error", (err) => {
    log.error({ taggedSessionId, err: err.message }, "Anthropic WebSocket error")
    ws.close(4003, "Upstream error")
  })

  ws.on("error", (err) => {
    log.error({ taggedSessionId, err: err.message }, "Client WebSocket error")
    anthropicWs.close()
  })
}
