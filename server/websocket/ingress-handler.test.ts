import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { IncomingMessage } from "http"
import { Socket } from "net"
import { EventEmitter } from "events"
import { WebSocket } from "ws"
import { prisma } from "../../src/lib/db"
import { generateUuid, uuidToSessionId } from "../../src/lib/id"
import { handleIngressConnection } from "./ingress-handler"
import * as sessionManagerModule from "./session-manager"
import * as jwtModule from "../../src/lib/auth/jwt"
import { TEST_USER_ID } from "../../vitest.setup"

// Minimal mock satisfying WebSocket interface used by handler
function createMockWs() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    sent: [] as string[],
    closeCode: undefined as number | undefined,
    closeReason: undefined as string | undefined,
    readyState: WebSocket.OPEN,
    send(data: string) {
      this.sent.push(data)
    },
    close(code?: number, reason?: string) {
      this.closeCode = code
      this.closeReason = reason
    },
    receive(data: string) {
      emitter.emit("message", Buffer.from(data))
    },
  }) as WebSocket & { sent: string[]; closeCode?: number; closeReason?: string; receive: (data: string) => void }
}

// Create a real IncomingMessage instance
function createMockReq(): IncomingMessage {
  return new IncomingMessage(new Socket())
}

const mockManager = {
  setIngress: vi.fn().mockReturnValue(null),
  removeIngress: vi.fn(),
  notify: vi.fn().mockResolvedValue(undefined),
  broadcastToSubscribers: vi.fn(),
}

vi.spyOn(sessionManagerModule, "getSessionManager").mockResolvedValue(mockManager as unknown as sessionManagerModule.SessionManager)

// Mock JWT auth to return authorized for the test session
const mockAuthWebSocket = vi.spyOn(jwtModule, "authenticateWebSocketRequest")

describe("ingress-handler", () => {
  const testEnvId = generateUuid()
  const testSessionId = generateUuid()

  beforeAll(async () => {
    await prisma.environment.create({
      data: { id: testEnvId, name: "Test Env", kind: "docker", state: "active", userId: TEST_USER_ID },
    })
    await prisma.session.create({
      data: {
        id: testSessionId,
        environmentId: testEnvId,
        status: "running",
        sessionContext: { model: "test", sources: [], outcomes: [], allowed_tools: [], disallowed_tools: [], cwd: "" },
      },
    })
  })

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { sessionId: testSessionId } })
    await prisma.session.deleteMany({ where: { environmentId: testEnvId } })
    await prisma.environment.delete({ where: { id: testEnvId } })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockManager.setIngress.mockReturnValue(null)
    // Default: authorize the test session
    mockAuthWebSocket.mockImplementation((req, expectedSessionId) => {
      if (expectedSessionId === uuidToSessionId(testSessionId)) {
        return {
          type: "session_authorized",
          payload: {
            session_id: expectedSessionId,
            repos: { read: [], write: [] },
            branches: [],
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
        }
      }
      return { type: "session_unauthorized", reason: "session_mismatch" }
    })
  })

  describe("authentication", () => {
    it("closes connection with 4001 when no token provided", async () => {
      const ws = createMockWs()
      mockAuthWebSocket.mockReturnValueOnce({ type: "session_unauthorized", reason: "no_token" })
      await handleIngressConnection(testSessionId, ws, createMockReq())
      expect(ws.closeCode).toBe(4001)
    })

    it("closes connection with 4001 when token is invalid", async () => {
      const ws = createMockWs()
      mockAuthWebSocket.mockReturnValueOnce({ type: "session_unauthorized", reason: "invalid_token" })
      await handleIngressConnection(testSessionId, ws, createMockReq())
      expect(ws.closeCode).toBe(4001)
    })

    it("closes connection with 4001 when token is for different session", async () => {
      const ws = createMockWs()
      mockAuthWebSocket.mockReturnValueOnce({ type: "session_unauthorized", reason: "session_mismatch" })
      await handleIngressConnection(testSessionId, ws, createMockReq())
      expect(ws.closeCode).toBe(4001)
    })

    it("closes connection with 4004 for non-existent session", async () => {
      const ws = createMockWs()
      const randomSessionId = generateUuid()
      // Mock auth to pass for this session
      mockAuthWebSocket.mockReturnValueOnce({
        type: "session_authorized",
        payload: {
          session_id: uuidToSessionId(randomSessionId),
          repos: { read: [], write: [] },
          branches: [],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      })
      await handleIngressConnection(randomSessionId, ws, createMockReq())
      expect(ws.closeCode).toBe(4004)
    })
  })

  it("closes connection when ingress already connected", async () => {
    const ws = createMockWs()
    mockManager.setIngress.mockReturnValue("Ingress already connected")
    await handleIngressConnection(testSessionId, ws, createMockReq())
    expect(ws.closeCode).toBe(4003)
  })

  it("removes ingress on close", async () => {
    const ws = createMockWs()
    await handleIngressConnection(testSessionId, ws, createMockReq())
    ws.emit("close")
    expect(mockManager.removeIngress).toHaveBeenCalledWith(testSessionId)
  })

  it("sends initialize control_request on connection", async () => {
    const ws = createMockWs()
    await handleIngressConnection(testSessionId, ws, createMockReq())

    // First message should be the initialize control_request
    expect(ws.sent.length).toBe(1)
    const initRequest = JSON.parse(ws.sent[0])
    expect(initRequest.type).toBe("control_request")
    expect(initRequest.request.subtype).toBe("initialize")
    expect(initRequest.request_id).toBeDefined()
  })

  it("persists valid event and notifies", async () => {
    const ws = createMockWs()
    await handleIngressConnection(testSessionId, ws, createMockReq())

    const eventUuid = generateUuid()
    ws.receive(JSON.stringify({ uuid: eventUuid, type: "user", message: { role: "user", content: "Hello" } }))

    // Wait for event to be persisted and notified
    await vi.waitFor(() => {
      expect(mockManager.notify).toHaveBeenCalledWith(testSessionId, eventUuid)
    })

    const saved = await prisma.event.findUnique({ where: { id: eventUuid } })
    expect(saved?.type).toBe("user")
  })

  it("logs warning for invalid event format", async () => {
    const ws = createMockWs()
    await handleIngressConnection(testSessionId, ws, createMockReq())

    // Invalid event (missing uuid) - just logged as warning, no response sent
    ws.receive(JSON.stringify({ type: "user" }))

    // Give time for processing
    await new Promise((r) => setTimeout(r, 50))
    // Only init request should be sent, no error response
    expect(ws.sent.length).toBe(1)
  })

  it("stores subtype and parent_tool_use_id", async () => {
    const ws = createMockWs()
    await handleIngressConnection(testSessionId, ws, createMockReq())

    const eventUuid = generateUuid()
    ws.receive(JSON.stringify({ uuid: eventUuid, type: "user", subtype: "tool_result", parent_tool_use_id: "toolu_123" }))

    // Wait for event to be persisted
    await vi.waitFor(() => {
      expect(mockManager.notify).toHaveBeenCalledWith(testSessionId, eventUuid)
    })

    const saved = await prisma.event.findUnique({ where: { id: eventUuid } })
    expect(saved?.subtype).toBe("tool_result")
    expect(saved?.parentToolUseId).toBe("toolu_123")
  })
})
