# Architecture Design

This document provides comprehensive documentation of the application architecture. This is a web application that provides a browser-based interface for Claude Code sessions, enabling users to run Claude Code in isolated Docker containers with real-time communication.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Server Architecture](#2-server-architecture)
3. [Provider Modes](#3-provider-modes)
4. [WebSocket System](#4-websocket-system)
5. [WebSocket Message Types](#5-websocket-message-types)
6. [REST API Routes](#6-rest-api-routes)
7. [Executor System](#7-executor-system)
8. [Adding Future Executors](#8-adding-future-executors)
9. [Authentication Summary](#9-authentication-summary)

---

## 1. High-Level Overview

The application follows a three-tier architecture with the browser frontend communicating with a Node.js server, which in turn manages Docker containers running Claude Code CLI instances.

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER'S BROWSER                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Next.js Frontend                              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐   │  │
│  │  │   React UI  │  │  Zustand     │  │  WebSocket Client          │   │  │
│  │  │  Components │◄─┤  Stores      │◄─┤  /ws/sessions/{id}         │   │  │
│  │  └─────────────┘  └──────────────┘  └────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP/WebSocket
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NODE.JS SERVER (port 3000)                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Custom HTTP/WebSocket Server                       │  │
│  │                        (server/index.ts)                              │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │  │
│  │  │   Next.js App   │  │   WebSocket     │  │   WebSocket         │   │  │
│  │  │   Router        │  │   /ws/sessions  │  │   /v1/session_      │   │  │
│  │  │   (API Routes)  │  │   /{id}         │  │   ingress/ws/{id}   │   │  │
│  │  └────────┬────────┘  └────────┬────────┘  └─────────┬───────────┘   │  │
│  │           │                    │                     │               │  │
│  │           ▼                    ▼                     ▼               │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │                     SessionManager                              │ │  │
│  │  │  (Pub/Sub Hub - max 3 subscribers + 1 ingress per session)     │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                       │              │              │
                       │              │              │
         ┌─────────────┘              │              └─────────────┐
         ▼                            ▼                            ▼
┌─────────────────┐        ┌─────────────────┐          ┌─────────────────┐
│    PostgreSQL   │        │     Docker      │          │    Anthropic    │
│    (Prisma)     │        │   Containers    │          │       API       │
│                 │        │                 │          │                 │
│  - Users        │        │ ┌─────────────┐ │          │  Used for:      │
│  - Sessions     │        │ │ Claude Code │ │          │  - Debug mode   │
│  - Events       │        │ │     CLI     │ │          │  - Model calls  │
│  - Environments │        │ └─────────────┘ │          │                 │
│                 │        │        │        │          │                 │
│  NOTIFY/LISTEN  │        │        │        │          │                 │
│  for multi-node │        │  WebSocket to   │          │                 │
│                 │        │  /v1/session_   │          │                 │
│                 │        │  ingress/ws/{id}│          │                 │
└─────────────────┘        └─────────────────┘          └─────────────────┘
```

### Key Directories

| Directory                               | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `server/`                               | Custom Node.js server with WebSocket handling     |
| `server/index.ts`                       | HTTP server, WebSocket upgrade routing            |
| `server/websocket/session-manager.ts`   | Pub/sub hub, manages client/container connections |
| `server/websocket/client-handler.ts`    | Browser WebSocket connections                     |
| `server/websocket/ingress-handler.ts`   | Container WebSocket connections                   |
| `server/websocket/anthropic-proxy.ts`   | Debug mode proxy to Anthropic API                 |
| `src/app/`                              | Next.js App Router (pages and API routes)         |
| `src/app/api/v1/sessions/`              | Session CRUD endpoints                            |
| `src/app/api/v1/environment_providers/` | Environment management                            |
| `src/app/api/anthropic/`                | Proxies requests to Anthropic API                 |
| `src/app/api/git-proxy/`                | Git HTTP proxy for container auth                 |
| `src/lib/`                              | Shared libraries                                  |
| `src/lib/executor/docker.ts`            | Docker container spawning                         |
| `src/lib/auth/`                         | BetterAuth, JWT handling                          |
| `src/lib/crypto/encryption.ts`          | AES-256-GCM encryption for secrets                |
| `src/lib/stores/`                       | Zustand stores for client state                   |

### Data Flow Summary

1. **Session Creation**: User creates session via REST API → stored in Postgres → returns session ID
2. **WebSocket Connection**: Browser connects to `/ws/sessions/{id}` → client-handler authenticates via cookies
3. **Container Spawn**: First subscriber triggers Docker container spawn with Claude Code CLI
4. **Ingress Connection**: Container connects back to `/v1/session_ingress/ws/{id}` → ingress-handler authenticates via JWT
5. **Message Relay**: Browser ↔ SessionManager ↔ Container, with Postgres NOTIFY for multi-node support
6. **Events Stored**: All events persisted to Postgres for history/resume capability

---

## 2. Server Architecture

The server uses a custom Node.js HTTP server that wraps Next.js, enabling WebSocket upgrade handling alongside the Next.js App Router.

### Server Initialization Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         server/index.ts                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. next({ dev, hostname, port })                                           │
│        │                                                                    │
│        ▼                                                                    │
│  2. app.prepare()                                                           │
│        │                                                                    │
│        ├──► getSessionManager() ──► Connect to Postgres for NOTIFY/LISTEN  │
│        │                                                                    │
│        ├──► app.getUpgradeHandler() ──► For Next.js HMR WebSockets         │
│        │                                                                    │
│        ▼                                                                    │
│  3. createServer((req, res) => handle(req, res, parsedUrl))                 │
│        │                                                                    │
│        ▼                                                                    │
│  4. new WebSocketServer({ noServer: true })                                 │
│        │                                                                    │
│        ▼                                                                    │
│  5. server.on('upgrade', (req, socket, head) => { ... })                    │
│        │                                                                    │
│        ├──► Pattern match URL                                               │
│        │       │                                                            │
│        │       ├─► /ws/sessions/{id}           ──► handleClientConnection   │
│        │       │                                                            │
│        │       ├─► /v1/session_ingress/ws/{id} ──► handleIngressConnection  │
│        │       │                                                            │
│        │       ├─► /_next/*                    ──► nextUpgradeHandler       │
│        │       │                                                            │
│        │       └─► other                       ──► socket.destroy()         │
│        │                                                                    │
│        ▼                                                                    │
│  6. startCleanupJob() ──► Stops idle containers every 60s                   │
│        │                                                                    │
│        ▼                                                                    │
│  7. server.listen(port)                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### WebSocket URL Patterns

```typescript
// Pattern definitions from server/index.ts
const CLIENT_WS_PATTERN = /^\/ws\/sessions\/([^/]+)$/
const INGRESS_WS_PATTERN = /^\/v1\/session_ingress\/ws\/([^/]+)$/
```

| Pattern                       | Handler                   | Authentication              | Purpose                |
| ----------------------------- | ------------------------- | --------------------------- | ---------------------- |
| `/ws/sessions/{id}`           | `handleClientConnection`  | BetterAuth cookies          | Browser connections    |
| `/v1/session_ingress/ws/{id}` | `handleIngressConnection` | JWT in Authorization header | Container connections  |
| `/_next/*`                    | Next.js handler           | None                        | Hot Module Replacement |

### HTTP Request Handling

All non-WebSocket HTTP requests are delegated to Next.js:

```typescript
const server = createServer((req, res) => {
  const parsedUrl = parse(req.url!, true)
  handle(req, res, parsedUrl) // Next.js request handler
})
```

### Shutdown Sequence

```typescript
const shutdown = async () => {
  log.info("Shutting down server")
  stopCleanupJob() // Stop container cleanup interval
  await manager.shutdown() // Close all WebSocket connections, disconnect Postgres
  server.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
```

---

## 3. Provider Modes

The application supports three provider modes that determine how Claude Code sessions are executed:

### Mode Comparison

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           PROVIDER MODES                                   │
├──────────────┬─────────────────────────────────────────────────────────────┤
│              │                                                             │
│   HOSTED     │  Server spawns Docker containers                            │
│   (default)  │  Server's Anthropic API key used for Claude                 │
│              │  Events stored in local Postgres                            │
│              │                                                             │
│              │  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│              │  │ Browser  │◄──►│  Server  │◄──►│ Docker   │              │
│              │  └──────────┘    │          │    │Container │              │
│              │                  │          │    └────┬─────┘              │
│              │                  │          │         │                     │
│              │                  │          │◄────────┘                     │
│              │                  │          │    /api/anthropic             │
│              │                  │          │         │                     │
│              │                  │          │    ┌────▼─────┐              │
│              │                  │          │    │Anthropic │              │
│              │                  └──────────┘    │   API    │              │
│              │                                  └──────────┘              │
├──────────────┼─────────────────────────────────────────────────────────────┤
│              │                                                             │
│   BYOK       │  Server spawns Docker containers                            │
│   (Bring     │  User's encrypted Anthropic API key used                    │
│   Your Own   │  Events stored in local Postgres                            │
│   Key)       │                                                             │
│              │  Same as hosted, but ANTHROPIC_API_KEY env var              │
│              │  is set to user's decrypted key in container                │
│              │                                                             │
├──────────────┼─────────────────────────────────────────────────────────────┤
│              │                                                             │
│   DEBUG      │  NO containers spawned                                      │
│              │  Proxies directly to Anthropic's WebSocket API              │
│              │  Uses user's anthropic session key + org UUID               │
│              │  Events stored by Anthropic, not locally                    │
│              │                                                             │
│              │  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│              │  │ Browser  │◄──►│  Server  │◄──►│Anthropic │              │
│              │  └──────────┘    │  (proxy) │    │WebSocket │              │
│              │                  └──────────┘    │   API    │              │
│              │                                  └──────────┘              │
│              │                                                             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### Provider Mode Selection

Provider mode is stored per-user in the `users` table:

```prisma
model User {
  // ...
  provider               Provider @default(hosted)
  anthropicApiKeyEnc     String?  // BYOK mode - encrypted API key
  anthropicSessionKeyEnc String?  // Debug mode - encrypted session key
  anthropicOrgUuid       String?  // Debug mode - organization UUID
}

enum Provider {
  hosted
  byok
  debug
}
```

### Debug Mode Proxy Implementation

Debug mode is _not_ an officially supported API endpoint, and there's no real benefit to using this over claude.ai/web; the rate limits are the same, it's still attributed to your account, etc. This is included because I built it while trying to make an interoperable product. Use at your own risk.

When a user is in debug mode, WebSocket connections are proxied directly to Anthropic:

```typescript
// From server/websocket/anthropic-proxy.ts
export function proxyToAnthropicWebSocket(
  taggedSessionId: string,
  ws: WebSocket,
  sessionKey: string,
  orgUuid: string,
  bufferedMessages: RawData[] = []
): void {
  const anthropicWsUrl = `wss://api.anthropic.com/v1/sessions/ws/${taggedSessionId}/subscribe?organization_uuid=${orgUuid}`

  const anthropicWs = new WebSocket(anthropicWsUrl, {
    headers: {
      Cookie: `sessionKey=${sessionKey}`,
    },
  })

  // Relay messages bidirectionally
  anthropicWs.on("message", (data, isBinary) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: isBinary })
    }
  })

  ws.on("message", (data, isBinary) => {
    if (anthropicWs.readyState === WebSocket.OPEN) {
      anthropicWs.send(data, { binary: isBinary })
    }
  })
}
```

---

## 4. WebSocket System

The WebSocket system uses a pub/sub pattern through `SessionManager` to relay messages between browsers and containers.

### SessionManager Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SessionManager                                    │
│                    (server/websocket/session-manager.ts)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    sessions: Map<sessionId, Session>                 │   │
│  │                                                                      │   │
│  │  Session = {                                                         │   │
│  │    subscribers: Set<WebSocket>   // max 3 browser connections        │   │
│  │    ingress: WebSocket | null     // single container connection      │   │
│  │  }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    pgClient: Client (Postgres)                       │   │
│  │                                                                      │   │
│  │  - LISTEN session_{uuid} for each active session                     │   │
│  │  - NOTIFY on new events for multi-node support                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Key Methods:                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  addSubscriber(sessionId, ws)      - Add browser connection (max 3)  │   │
│  │  removeSubscriber(sessionId, ws)   - Remove browser connection       │   │
│  │  setIngress(sessionId, ws)         - Set/replace container conn      │   │
│  │  removeIngress(sessionId)          - Remove container connection     │   │
│  │  sendToIngress(sessionId, msg)     - Forward message to container    │   │
│  │  broadcastToSubscribers(id, msg)   - Broadcast to all browsers       │   │
│  │  notify(sessionId, eventId)        - Postgres NOTIFY for multi-node  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Connection Limits

| Connection Type        | Max per Session | Purpose                     |
| ---------------------- | --------------- | --------------------------- |
| Subscribers (browsers) | 3               | Allow multiple browser tabs |
| Ingress (container)    | 1               | Single Claude Code instance |

### Message Flow: Browser to Container (Hosted/BYOK Mode)

```
┌──────────┐    ┌──────────────────┐    ┌────────────────┐    ┌──────────────┐
│  Browser │    │  client-handler  │    │ SessionManager │    │  Container   │
└────┬─────┘    └────────┬─────────┘    └───────┬────────┘    └──────┬───────┘
     │                   │                      │                    │
     │  WebSocket msg    │                      │                    │
     ├──────────────────►│                      │                    │
     │                   │                      │                    │
     │                   │  Update session      │                    │
     │                   │  updatedAt           │                    │
     │                   ├──────────────────────┤                    │
     │                   │                      │                    │
     │                   │  If type="user":     │                    │
     │                   │  broadcastToSubs     │                    │
     │                   ├──────────────────────┤                    │
     │                   │                      │                    │
     │  (echo back)      │                      │                    │
     │◄─ ─ ─ ─ ─ ─ ─ ─ ─ ┤                      │                    │
     │                   │                      │                    │
     │                   │  sendToIngress       │                    │
     │                   ├──────────────────────►                    │
     │                   │                      │                    │
     │                   │                      │  ws.send(msg+"\n") │
     │                   │                      ├───────────────────►│
     │                   │                      │                    │
```

### Message Flow: Container to Browser (Hosted/BYOK Mode)

```
┌──────────────┐    ┌─────────────────┐    ┌────────────────┐    ┌──────────┐
│  Container   │    │ ingress-handler │    │ SessionManager │    │  Browser │
└──────┬───────┘    └────────┬────────┘    └───────┬────────┘    └────┬─────┘
       │                     │                     │                  │
       │  WebSocket msg      │                     │                  │
       ├────────────────────►│                     │                  │
       │                     │                     │                  │
       │                     │  Parse & validate   │                  │
       │                     │  (IngressMessage)   │                  │
       │                     │                     │                  │
       │                     │  Store in Postgres  │                  │
       │                     │  (events table)     │                  │
       │                     ├─────────────────────┤                  │
       │                     │                     │                  │
       │                     │  pg NOTIFY          │                  │
       │                     │  (for multi-node)   │                  │
       │                     ├─────────────────────►                  │
       │                     │                     │                  │
       │                     │                     │  pg LISTEN       │
       │                     │                     │◄─────────────────┤
       │                     │                     │                  │
       │                     │                     │  Fetch event     │
       │                     │                     │  from Postgres   │
       │                     │                     │                  │
       │                     │                     │  broadcast to    │
       │                     │                     │  all subscribers │
       │                     │                     ├─────────────────►│
       │                     │                     │                  │
```

### Message Flow: Debug Mode

```
┌──────────┐    ┌──────────────────┐    ┌────────────────────┐
│  Browser │    │  anthropic-proxy │    │  Anthropic WS API  │
└────┬─────┘    └────────┬─────────┘    └─────────┬──────────┘
     │                   │                        │
     │  WebSocket msg    │                        │
     ├──────────────────►│                        │
     │                   │                        │
     │                   │  Forward (raw bytes)   │
     │                   ├───────────────────────►│
     │                   │                        │
     │                   │                        │
     │                   │  Response from Claude  │
     │                   │◄───────────────────────┤
     │                   │                        │
     │  Forward response │                        │
     │◄──────────────────┤                        │
     │                   │                        │
```

### Multi-Node Support via Postgres NOTIFY/LISTEN

When running multiple server instances, Postgres NOTIFY/LISTEN ensures events are broadcast to all connected browsers:

```typescript
// SessionManager subscribes to session channels
private async listenToChannel(sessionId: string): Promise<void> {
  const channel = this.sessionIdToChannel(sessionId)
  this.channelToSession.set(channel, sessionId)
  await this.pgClient.query(`LISTEN ${channel}`)
}

// When container sends event, notify all nodes
async notify(sessionId: string, eventId: string): Promise<void> {
  const channel = this.sessionIdToChannel(sessionId)
  await this.pgClient.query("SELECT pg_notify($1, $2)", [channel, eventId])
}

// Handle notification by fetching event and broadcasting
private handleNotification(channel: string, eventId: string | undefined): void {
  // ... fetch event from Postgres and broadcast to local subscribers
}
```

---

## 5. WebSocket Message Types

All message types are defined in `src/lib/schemas/event.ts` using Zod schemas.

### Message Type Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IngressMessage (discriminated union)                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐                          │
│  │  control_request    │  │  control_response   │                          │
│  │  (from container)   │  │  (from container)   │                          │
│  └─────────────────────┘  └─────────────────────┘                          │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │  user               │  │  assistant          │  │  tool_use           │ │
│  │  (user message)     │  │  (claude response)  │  │  (tool invocation)  │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │  tool_result        │  │  system             │  │  result             │ │
│  │  (tool output)      │  │  (system message)   │  │  (final result)     │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Control Protocol

#### control_request (Container → Server)

Used by the container to request permissions or actions from the server.

**TypeScript Definition:**

```typescript
export const ControlRequest = z.object({
  type: z.literal("control_request"),
  request_id: z.string(),
  request: z
    .object({
      subtype: z.string(),
    })
    .passthrough(),
})
```

**Example: Permission Request (can_use_tool)**

```json
{
  "type": "control_request",
  "request_id": "req_abc123",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "Bash",
    "input": {
      "command": "git status"
    }
  }
}
```

**Server Response (auto-approve):**

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "req_abc123",
    "response": {
      "behavior": "allow",
      "updatedInput": {
        "command": "git status"
      }
    }
  }
}
```

**Example: Initialize Request**

```json
{
  "type": "control_request",
  "request_id": "init_xyz789",
  "request": {
    "subtype": "initialize"
  }
}
```

#### control_response (Container → Server)

Sent by the container in response to server-initiated control requests.

**TypeScript Definition:**

```typescript
export const ControlResponse = z.object({
  type: z.literal("control_response"),
  response: z
    .object({
      request_id: z.string(),
      subtype: z.string(),
    })
    .passthrough(),
})
```

**Example:**

```json
{
  "type": "control_response",
  "response": {
    "request_id": "init_xyz789",
    "subtype": "success"
  }
}
```

### Conversation Events

#### Common Event Base Fields

```typescript
const eventBase = {
  uuid: z.string().uuid(), // Unique event ID
  session_id: z.string().optional(), // Tagged session ID (e.g., "session_...")
  subtype: z.string().optional(), // Event subtype
  parent_tool_use_id: z.string().nullable().optional(), // For tool results
}
```

#### user Event (Browser → Container)

Represents a user message sent to Claude.

**TypeScript Definition:**

```typescript
export const UserEvent = z
  .object({
    type: z.literal("user"),
    ...eventBase,
  })
  .passthrough()
```

**Example:**

```json
{
  "type": "user",
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "session_0A1B2C3D4E5F6G7H8I9J0K1L",
  "message": {
    "role": "user",
    "content": "Can you help me refactor this function?"
  }
}
```

#### assistant Event (Container → Browser)

Represents Claude's text response.

**TypeScript Definition:**

```typescript
export const AssistantEvent = z
  .object({
    type: z.literal("assistant"),
    ...eventBase,
  })
  .passthrough()
```

**Example:**

```json
{
  "type": "assistant",
  "uuid": "660e8400-e29b-41d4-a716-446655440001",
  "session_id": "session_0A1B2C3D4E5F6G7H8I9J0K1L",
  "message": {
    "role": "assistant",
    "content": "I'll help you refactor that function. Let me first read the current implementation."
  }
}
```

#### tool_use Event (Container → Browser)

Indicates Claude is invoking a tool.

**Example:**

```json
{
  "type": "tool_use",
  "uuid": "770e8400-e29b-41d4-a716-446655440002",
  "session_id": "session_0A1B2C3D4E5F6G7H8I9J0K1L",
  "subtype": "Read",
  "tool_use": {
    "id": "tool_abc123",
    "name": "Read",
    "input": {
      "file_path": "/workspace/src/utils.ts"
    }
  }
}
```

#### tool_result Event (Container → Browser)

Contains the output from a tool execution.

**Example:**

```json
{
  "type": "tool_result",
  "uuid": "880e8400-e29b-41d4-a716-446655440003",
  "session_id": "session_0A1B2C3D4E5F6G7H8I9J0K1L",
  "parent_tool_use_id": "tool_abc123",
  "tool_result": {
    "output": "export function calculateSum(a: number, b: number): number {\n  return a + b;\n}"
  }
}
```

#### system Event (Container → Browser)

System-level messages (errors, warnings, etc.).

**Example:**

```json
{
  "type": "system",
  "uuid": "990e8400-e29b-41d4-a716-446655440004",
  "session_id": "session_0A1B2C3D4E5F6G7H8I9J0K1L",
  "subtype": "error",
  "message": "Tool execution timed out after 120 seconds"
}
```

#### result Event (Container → Browser)

Final result when Claude completes a task.

**Example:**

```json
{
  "type": "result",
  "uuid": "aa0e8400-e29b-41d4-a716-446655440005",
  "session_id": "session_0A1B2C3D4E5F6G7H8I9J0K1L",
  "subtype": "success",
  "result": {
    "cost_usd": 0.0234,
    "duration_ms": 45230,
    "tokens": {
      "input": 1250,
      "output": 890
    }
  }
}
```

### Event Wrapper Format

Events can be sent in a wrapped format (used in POST /v1/sessions):

```typescript
export const WrappedEvent = z.object({
  type: z.literal("event"),
  data: BaseEvent,
})
```

**Example:**

```json
{
  "type": "event",
  "data": {
    "type": "user",
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "message": {
      "role": "user",
      "content": "Hello!"
    }
  }
}
```

---

## 6. REST API Routes

### ID Encoding

The application uses Base62-encoded tagged IDs for external APIs:

```typescript
// From src/lib/id.ts
const SESSION_PREFIX = "session_"
const ENV_PREFIX = "env_"

// UUID -> Tagged ID
export function uuidToSessionId(uuid: string): string {
  return SESSION_PREFIX + uuidToBase62(uuid)
}

// Tagged ID -> UUID
export function sessionIdToUuid(sessionId: string): string {
  if (!sessionId.startsWith(SESSION_PREFIX)) {
    throw new Error(`Invalid session ID format: ${sessionId}`)
  }
  const encoded = sessionId.slice(SESSION_PREFIX.length)
  return base62ToUuid(encoded)
}
```

**Examples:**

- Session: `session_0A1B2C3D4E5F6G7H8I9J0K1L` (24-char base62 after prefix)
- Environment: `env_0A1B2C3D4E5F6G7H8I9J0K1L`

### Sessions API

#### POST /api/v1/sessions

Create a new session.

**Request:**

```json
{
  "title": "Refactor authentication module",
  "environment_id": "env_0A1B2C3D4E5F6G7H8I9J0K1L",
  "session_context": {
    "model": "claude-sonnet-4-20250514",
    "sources": [
      {
        "type": "git_repository",
        "url": "https://github.com/myorg/myrepo.git"
      }
    ],
    "outcomes": [
      {
        "type": "git_repository",
        "git_info": {
          "type": "github",
          "repo": "myorg/myrepo",
          "branches": ["feature/auth-refactor"]
        }
      }
    ],
    "allowed_tools": [],
    "disallowed_tools": [],
    "cwd": "/workspace/myrepo"
  },
  "events": [
    {
      "type": "event",
      "data": {
        "type": "user",
        "uuid": "550e8400-e29b-41d4-a716-446655440000",
        "message": {
          "role": "user",
          "content": "Please refactor the authentication module to use JWT tokens."
        }
      }
    }
  ]
}
```

**Response (201 Created):**

```json
{
  "id": "session_1X2Y3Z4A5B6C7D8E9F0G1H2I",
  "title": "Refactor authentication module",
  "environment_id": "env_0A1B2C3D4E5F6G7H8I9J0K1L",
  "session_status": "running",
  "type": "internal_session",
  "session_context": {
    "model": "claude-sonnet-4-20250514",
    "sources": [...],
    "outcomes": [...],
    "allowed_tools": [],
    "disallowed_tools": [],
    "cwd": "/workspace/myrepo"
  },
  "created_at": "2025-01-20T10:30:00.000Z",
  "updated_at": "2025-01-20T10:30:00.000Z"
}
```

#### GET /api/v1/sessions

List all sessions for the authenticated user.

**Query Parameters:**

- `limit` (optional): Number of sessions to return (default: 20)
- `after` (optional): Cursor for pagination

**Response:**

```json
{
  "data": [
    {
      "id": "session_1X2Y3Z4A5B6C7D8E9F0G1H2I",
      "title": "Refactor authentication module",
      "environment_id": "env_0A1B2C3D4E5F6G7H8I9J0K1L",
      "session_status": "running",
      "type": "internal_session",
      "session_context": {...},
      "created_at": "2025-01-20T10:30:00.000Z",
      "updated_at": "2025-01-20T10:35:00.000Z"
    }
  ],
  "has_more": true,
  "first_id": "session_1X2Y3Z4A5B6C7D8E9F0G1H2I",
  "last_id": "session_2A3B4C5D6E7F8G9H0I1J2K3L"
}
```

#### GET /api/v1/sessions/{id}

Get a specific session.

**Response:**

```json
{
  "id": "session_1X2Y3Z4A5B6C7D8E9F0G1H2I",
  "title": "Refactor authentication module",
  "environment_id": "env_0A1B2C3D4E5F6G7H8I9J0K1L",
  "session_status": "running",
  "type": "internal_session",
  "session_context": {
    "model": "claude-sonnet-4-20250514",
    "sources": [],
    "outcomes": [],
    "allowed_tools": [],
    "disallowed_tools": [],
    "cwd": ""
  },
  "created_at": "2025-01-20T10:30:00.000Z",
  "updated_at": "2025-01-20T10:35:00.000Z"
}
```

#### PATCH /api/v1/sessions/{id}

Update a session (currently only title).

**Request:**

```json
{
  "title": "Updated title for session"
}
```

**Response:** Same as GET.

#### DELETE /api/v1/sessions/{id}

Soft-delete a session (stops container, sets status to "deleted").

**Response:**

```json
{
  "id": "session_1X2Y3Z4A5B6C7D8E9F0G1H2I",
  "type": "session_deleted"
}
```

#### POST /api/v1/sessions/{id}/archive

Archive a session (stops container, sets status to "archived").

**Response:** Same as GET (with status "archived").

### Events API

#### GET /api/v1/sessions/{id}/events

Get all events for a session.

**Query Parameters:**

- `limit` (optional): Number of events to return
- `after` (optional): Cursor for pagination

**Response:**

```json
{
  "data": [
    {
      "type": "user",
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "session_id": "session_1X2Y3Z4A5B6C7D8E9F0G1H2I",
      "message": {
        "role": "user",
        "content": "Hello!"
      }
    },
    {
      "type": "assistant",
      "uuid": "660e8400-e29b-41d4-a716-446655440001",
      "session_id": "session_1X2Y3Z4A5B6C7D8E9F0G1H2I",
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      }
    }
  ],
  "has_more": false
}
```

### Environment Providers API

#### GET /api/v1/environment_providers

List all environments for the authenticated user.

**Response:**

```json
{
  "environments": [
    {
      "kind": "local",
      "environment_id": "env_0A1B2C3D4E5F6G7H8I9J0K1L",
      "name": "Default Environment",
      "created_at": "2025-01-15T08:00:00.000Z",
      "state": "active",
      "config": null
    }
  ],
  "has_more": false,
  "first_id": "env_0A1B2C3D4E5F6G7H8I9J0K1L",
  "last_id": "env_0A1B2C3D4E5F6G7H8I9J0K1L"
}
```

#### POST /api/v1/environment_providers/{id}/create

Create a new environment.

**Request:**

```json
{
  "name": "Production Environment",
  "kind": "local",
  "config": {
    "cwd": "/workspace",
    "environment": {
      "NODE_ENV": "production"
    },
    "network_config": {
      "allow_outbound": true,
      "allowed_hosts": ["api.github.com"]
    }
  }
}
```

**Response:**

```json
{
  "kind": "local",
  "environment_id": "env_3C4D5E6F7G8H9I0J1K2L3M4N",
  "name": "Production Environment",
  "created_at": "2025-01-20T11:00:00.000Z",
  "state": "active",
  "config": {...}
}
```

### Session Ingress API (Container Use Only)

These endpoints are used by containers to fetch/update session state.

#### GET /api/v1/session_ingress/session/{id}

Get all sent events for a session (used by `--resume` flag).

**Authentication:** JWT in Authorization header or x-api-key.

**Response:**

```json
{
  "loglines": [
    {
      "type": "user",
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "message": {...}
    },
    {
      "type": "assistant",
      "uuid": "660e8400-e29b-41d4-a716-446655440001",
      "message": {...}
    }
  ]
}
```

#### PUT /api/v1/session_ingress/session/{id}

Append an event to a session (used by container for persistence).

**Headers:**

- `Authorization: Bearer <jwt>`
- `Last-Uuid: <uuid>` (optional, for optimistic concurrency)

**Request:**

```json
{
  "type": "assistant",
  "uuid": "770e8400-e29b-41d4-a716-446655440002",
  "message": {
    "role": "assistant",
    "content": "I've completed the refactoring."
  }
}
```

**Response:**

```json
{
  "message": "Log appended successfully",
  "success": true
}
```

### Settings API

#### GET /api/settings

Get current user settings.

**Response:**

```json
{
  "provider": "hosted",
  "anthropicApiKeyMasked": null,
  "anthropicSessionKeyMasked": null,
  "anthropicOrgUuid": null
}
```

**Response (BYOK mode):**

```json
{
  "provider": "byok",
  "anthropicApiKeyMasked": "sk-ant-...abc123",
  "anthropicSessionKeyMasked": null,
  "anthropicOrgUuid": null
}
```

**Response (Debug mode):**

```json
{
  "provider": "debug",
  "anthropicApiKeyMasked": null,
  "anthropicSessionKeyMasked": "sk-...xyz789",
  "anthropicOrgUuid": "org_abcdef123456"
}
```

#### PATCH /api/settings

Update user settings.

**Request (switch to BYOK):**

```json
{
  "provider": "byok",
  "anthropicApiKey": "sk-ant-api03-full-key-here"
}
```

**Request (switch to debug):**

```json
{
  "provider": "debug",
  "anthropicSessionKey": "sk-full-session-key-here",
  "anthropicOrgUuid": "org_abcdef123456"
}
```

**Response:** Same as GET.

### Authentication Routes

Authentication is handled by BetterAuth with GitHub OAuth.

#### GET /api/auth/github

Initiate GitHub OAuth flow.

#### GET /api/auth/github/callback

Handle GitHub OAuth callback.

---

## 7. Executor System

The executor system provides an abstraction layer for spawning and managing Claude Code instances.

### Executor Dispatch Pattern

```typescript
// From src/lib/executor/index.ts

export async function spawnSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "local") {
    await spawnContainer(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}

export async function stopSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "local") {
    await stopSessionContainer(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}

export async function removeSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "local") {
    await removeSessionContainer(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}
```

### Docker Executor Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Docker Container Lifecycle                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. SPAWN (spawnContainer)                                                  │
│     │                                                                       │
│     ├─► Check if session.containerId exists                                 │
│     │      │                                                                │
│     │      ├─► YES: Restart existing container                              │
│     │      │        - Start if stopped                                      │
│     │      │        - Kill existing Claude processes                        │
│     │      │        - Exec new Claude process with fresh JWT               │
│     │      │                                                                │
│     │      └─► NO: Create new container                                     │
│     │              - docker.createContainer()                               │
│     │              - container.start()                                      │
│     │              - container.exec() with Claude CLI                       │
│     │                                                                       │
│     ├─► Attach to stdout/stderr for logging                                 │
│     │                                                                       │
│     └─► Set up container.wait() for exit handling                           │
│                                                                             │
│  2. RUNNING                                                                 │
│     │                                                                       │
│     ├─► Container connects to /v1/session_ingress/ws/{id}                   │
│     │                                                                       │
│     ├─► Messages relayed via SessionManager                                 │
│     │                                                                       │
│     └─► Activity tracked via session.updatedAt                              │
│                                                                             │
│  3. IDLE (cleanupIdleSessions - runs every 60s)                             │
│     │                                                                       │
│     ├─► Find sessions idle > 5 minutes                                      │
│     │                                                                       │
│     └─► Stop containers (SIGTERM, then SIGKILL after 5s)                    │
│                                                                             │
│  4. STOP (stopSessionContainer - called on archive)                         │
│     │                                                                       │
│     └─► container.stop({ t: 5 }) - graceful shutdown                        │
│                                                                             │
│  5. REMOVE (removeSessionContainer - called on delete)                      │
│     │                                                                       │
│     └─► container.remove({ force: true }) - force remove                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Container Configuration

```typescript
// From src/lib/executor/docker.ts

function buildClaudeConfig(session: Session, context: SessionContext, environmentVariables?: Record<string, string>): ClaudeConfig {
  const token = generateSessionJwt(session)
  const taggedSessionId = uuidToSessionId(session.id)
  const wsUrl = config.apiUrlForDockerContainers.replace(/^http/, "ws")

  const args = [
    "--output-format=stream-json",
    "--input-format=stream-json",
    "--verbose",
    "--replay-user-messages",
    `--model=${context.model}`,
    `--sdk-url=${wsUrl}/v1/session_ingress/ws/${taggedSessionId}`,
    `--resume=${config.apiUrlForDockerContainers}/api/v1/session_ingress/session/${taggedSessionId}`,
  ]

  if (context.allowed_tools.length > 0) {
    args.push(`--allowed-tools=${context.allowed_tools.join(",")}`)
  }

  if (context.disallowed_tools.length > 0) {
    args.push(`--disallowed-tools=${context.disallowed_tools.join(",")}`)
  }

  const env = [
    `TOKEN=${token}`,
    `CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR=3`,
    `CLAUDE_CODE_SESSION_ACCESS_TOKEN=${token}`,
    `ANTHROPIC_BASE_URL=${config.apiUrlForDockerContainers}/api/anthropic`,
    `ANTHROPIC_API_KEY=${token}`,
    ...Object.entries(environmentVariables ?? {}).map(([k, v]) => `${k}=${v}`),
  ]

  const command = `exec 3<<<"$TOKEN" && exec claude ${args.map((a) => `'${a}'`).join(" ")}`

  return { args, env, command }
}
```

### Container Security: Metadata Endpoint Blocking

Containers block cloud metadata endpoints to prevent SSRF attacks:

```typescript
// Block cloud metadata endpoints to prevent SSRF attacks
const metadataBlackholes: string[] = [
  "169.254.169.254:127.0.0.1", // AWS, GCP, Azure metadata
  "169.254.170.2:127.0.0.1", // AWS ECS task metadata
  "fd00:ec2::254:127.0.0.1", // AWS IPv6 metadata
]

const container = await docker.createContainer({
  // ...
  HostConfig: {
    ExtraHosts: [...metadataBlackholes, ...devHosts],
  },
})
```

### Container Exit Handling

```typescript
container.wait().then(async (result) => {
  const code = result.StatusCode
  log.info({ sessionId, exitCode: code }, "Claude Code container exited")
  activeContainers.delete(sessionId)

  // Exit codes: 0=success, 143=SIGTERM (graceful stop), 137=SIGKILL
  const newStatus = code === 0 ? "completed" : code === 143 || code === 137 ? "idle" : "failed"
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: newStatus },
  })
})
```

---

## 8. Adding Future Executors

The executor system is designed to support additional backends beyond Docker. Here's how to add a new executor (e.g., Kubernetes).

### Executor Interface Requirements

Any new executor must implement the three core functions that the dispatch layer calls:

```typescript
// Required functions to implement for a new executor

/**
 * Spawns a new instance for a session OR restarts an existing one.
 * Called when a browser connects to a session that needs a running instance.
 */
export async function spawnSession(session: SessionWithEnvironment): Promise<void>

/**
 * Stops a session's instance gracefully. Called when archiving a session.
 * Should not throw if instance is already stopped or doesn't exist.
 */
export async function stopSession(session: SessionWithEnvironment): Promise<void>

/**
 * Removes a session's instance entirely. Called when deleting a session.
 * Should stop first if running. Should not throw if instance doesn't exist.
 */
export async function removeSession(session: SessionWithEnvironment): Promise<void>
```

### WebSocket Connection Requirements

The spawned instance must:

1. **Connect to the ingress WebSocket endpoint**: `/v1/session_ingress/ws/{id}`
2. **Authenticate using JWT**: Pass token in `Authorization: Bearer <jwt>` header
3. **Handle the standard message protocol** (JSON-newline delimited)

### Required Environment Variables

```bash
# JWT for WebSocket authentication
TOKEN=<jwt>

# Tell Claude Code to read auth from file descriptor 3
CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR=3

# Alternative: Session access token
CLAUDE_CODE_SESSION_ACCESS_TOKEN=<jwt>

# Route Anthropic API calls through the server proxy
ANTHROPIC_BASE_URL=<server_url>/api/anthropic
ANTHROPIC_API_KEY=<jwt>  # Server validates JWT, forwards with real key
```

### Claude Code CLI Arguments

```bash
claude \
  --output-format=stream-json \
  --input-format=stream-json \
  --verbose \
  --replay-user-messages \
  --model=<model_id> \
  --sdk-url=<ws_server_url>/v1/session_ingress/ws/<tagged_session_id> \
  --resume=<http_server_url>/api/v1/session_ingress/session/<tagged_session_id>
```

### Example: Kubernetes Executor Skeleton

```typescript
// src/lib/executor/kubernetes.ts

import { Client } from "kubernetes-client"
import { generateSessionJwt } from "@/lib/auth/jwt"
import { uuidToSessionId } from "@/lib/id"
import { config } from "@/config"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import type { SessionWithEnvironment } from "./index"

const k8sClient = new Client({ version: "1.13" })
const NAMESPACE = "claude-code"

/**
 * Spawns a Kubernetes pod for a session.
 * If session.containerId exists, attempts to restart/replace the existing pod.
 */
export async function spawnK8sPod(session: SessionWithEnvironment): Promise<void> {
  const sessionId = session.id
  const podName = `claude-session-${sessionId.slice(0, 8)}`
  const taggedSessionId = uuidToSessionId(sessionId)
  const token = generateSessionJwt(session)
  const wsUrl = config.apiUrlForDockerContainers.replace(/^http/, "ws")

  // Check if pod already exists
  if (session.containerId) {
    try {
      const existingPod = await k8sClient.api.v1.namespaces(NAMESPACE).pods(podName).get()

      if (existingPod.body.status.phase === "Running") {
        log.info({ sessionId, podName }, "Pod already running, deleting to restart")
        await k8sClient.api.v1.namespaces(NAMESPACE).pods(podName).delete()
        // Wait for deletion before creating new pod
        await waitForPodDeletion(podName)
      }
    } catch (err) {
      // Pod doesn't exist, will create new one
    }
  }

  const podManifest = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName,
      labels: {
        app: "claude-code",
        sessionId: sessionId,
      },
    },
    spec: {
      containers: [
        {
          name: "claude-code",
          image: "agent-quickstart/claude-code:latest",
          command: ["/bin/bash", "-c"],
          args: [
            `exec 3<<<"$TOKEN" && exec claude ` +
              `--output-format=stream-json ` +
              `--input-format=stream-json ` +
              `--verbose ` +
              `--replay-user-messages ` +
              `--model=${session.sessionContext.model} ` +
              `--sdk-url=${wsUrl}/v1/session_ingress/ws/${taggedSessionId} ` +
              `--resume=${config.apiUrlForDockerContainers}/api/v1/session_ingress/session/${taggedSessionId}`,
          ],
          env: [
            { name: "TOKEN", value: token },
            { name: "CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR", value: "3" },
            { name: "CLAUDE_CODE_SESSION_ACCESS_TOKEN", value: token },
            { name: "ANTHROPIC_BASE_URL", value: `${config.apiUrlForDockerContainers}/api/anthropic` },
            { name: "ANTHROPIC_API_KEY", value: token },
          ],
          resources: {
            requests: { cpu: "500m", memory: "512Mi" },
            limits: { cpu: "2", memory: "4Gi" },
          },
        },
      ],
      restartPolicy: "Never",
    },
  }

  await k8sClient.api.v1.namespaces(NAMESPACE).pods.post({ body: podManifest })

  // Update session with pod name
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "running", containerId: podName },
  })

  log.info({ sessionId, podName }, "Created Kubernetes pod for session")
}

/**
 * Stops a session's pod gracefully.
 * Does not throw if pod is already stopped or doesn't exist.
 */
export async function stopK8sPod(session: SessionWithEnvironment): Promise<void> {
  if (!session.containerId) {
    return
  }

  const podName = session.containerId

  try {
    await k8sClient.api.v1
      .namespaces(NAMESPACE)
      .pods(podName)
      .delete({
        body: { gracePeriodSeconds: 5 },
      })
    log.info({ sessionId: session.id, podName }, "Stopped Kubernetes pod")
  } catch (err: any) {
    // 404 = pod doesn't exist - that's fine
    if (err.statusCode !== 404) {
      log.error({ sessionId: session.id, podName, err }, "Failed to stop Kubernetes pod")
      throw err
    }
  }
}

/**
 * Removes a session's pod entirely.
 * Does not throw if pod doesn't exist.
 */
export async function removeK8sPod(session: SessionWithEnvironment): Promise<void> {
  if (!session.containerId) {
    return
  }

  const podName = session.containerId

  try {
    await k8sClient.api.v1
      .namespaces(NAMESPACE)
      .pods(podName)
      .delete({
        body: { gracePeriodSeconds: 0 }, // Force delete
      })
    log.info({ sessionId: session.id, podName }, "Removed Kubernetes pod")
  } catch (err: any) {
    // 404 = pod doesn't exist - that's fine
    if (err.statusCode !== 404) {
      log.error({ sessionId: session.id, podName, err }, "Failed to remove Kubernetes pod")
      throw err
    }
  }
}

async function waitForPodDeletion(podName: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await k8sClient.api.v1.namespaces(NAMESPACE).pods(podName).get()
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch {
      return // Pod no longer exists
    }
  }
  throw new Error(`Timeout waiting for pod ${podName} to be deleted`)
}
```

### Updating the Executor Dispatch

After implementing the executor functions, add the new kind to the dispatch layer:

```typescript
// src/lib/executor/index.ts

import { spawnContainer, stopSessionContainer, removeSessionContainer } from "./docker"
import { spawnK8sPod, stopK8sPod, removeK8sPod } from "./kubernetes"

export async function spawnSession(session: SessionWithEnvironment): Promise<void> {
  switch (session.environment.kind) {
    case "local":
      await spawnContainer(session)
      return
    case "kubernetes":
      await spawnK8sPod(session)
      return
    default:
      throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
  }
}

export async function stopSession(session: SessionWithEnvironment): Promise<void> {
  switch (session.environment.kind) {
    case "local":
      await stopSessionContainer(session)
      return
    case "kubernetes":
      await stopK8sPod(session)
      return
    default:
      throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
  }
}

export async function removeSession(session: SessionWithEnvironment): Promise<void> {
  switch (session.environment.kind) {
    case "local":
      await removeSessionContainer(session)
      return
    case "kubernetes":
      await removeK8sPod(session)
      return
    default:
      throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
  }
}
```

### Adding the Environment Kind

Update the Prisma schema and environment schemas to support the new kind:

```prisma
// prisma/schema.prisma - update environment kind validation
```

```typescript
// src/lib/schemas/environment.ts
export const EnvironmentKind = z.enum(["local", "anthropic_cloud", "kubernetes"])
```

---

## 9. Authentication Summary

The application uses multiple authentication mechanisms depending on the component and context.

### Authentication Matrix

| Connection            | Method             | Token Location                               | Validator                        |
| --------------------- | ------------------ | -------------------------------------------- | -------------------------------- |
| Browser → REST API    | BetterAuth session | Cookie (`agent-quickstart.session_token`)         | `getSession()` from BetterAuth   |
| Browser → WebSocket   | BetterAuth session | Cookie header                                | `authenticateFromCookies()`      |
| Container → WebSocket | JWT                | `Authorization: Bearer <jwt>`                | `authenticateWebSocketRequest()` |
| Container → REST API  | JWT                | `Authorization: Bearer <jwt>` or `x-api-key` | `authenticateSessionRequest()`   |
| Git Proxy             | JWT                | Basic auth (username ignored)                | Extracted from password field    |

### JWT Token Structure

```typescript
export type SessionJwtPayload = {
  session_id: string // Tagged session ID (e.g., "session_...")
  repos: {
    read: string[] // Repos Claude can read from
    write: string[] // Repos Claude can push to
  }
  branches: string[] // Allowed branches for push
  iat: number // Issued at timestamp
  exp: number // Expiration (4 hours)
}
```

### JWT Generation

```typescript
// From src/lib/auth/jwt.ts

export function generateSessionJwt(session: Session): string {
  const contextResult = SessionContext.safeParse(session.sessionContext)
  const { repos, branches } = extractScopes(contextResult.data)

  return jwt.sign(
    {
      session_id: uuidToSessionId(session.id),
      repos,
      branches,
      iat: Math.floor(Date.now() / 1000),
    },
    config.jwtSecret,
    { expiresIn: "4h" }
  )
}
```

### BetterAuth Cookie Authentication

```typescript
// From server/websocket/client-handler.ts

async function authenticateFromCookies(req: IncomingMessage) {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return null

  const headers = new Headers()
  headers.set("cookie", cookieHeader)

  try {
    const session = await auth.api.getSession({ headers })
    return session?.user ?? null
  } catch {
    return null
  }
}
```

### Secrets Encryption

All sensitive data is encrypted at rest using AES-256-GCM:

| Field                    | Table         | Purpose                   |
| ------------------------ | ------------- | ------------------------- |
| `anthropicApiKeyEnc`     | users         | BYOK mode API key         |
| `anthropicSessionKeyEnc` | users         | Debug mode session key    |
| `configEnc`              | environments  | Environment variables     |
| `accessTokenEnc`         | accounts      | OAuth tokens              |
| `refreshTokenEnc`        | accounts      | OAuth refresh tokens      |
| `tokenEnc`               | auth_sessions | BetterAuth session tokens |

### Authentication Flow Diagrams

#### Browser REST API Authentication

```
┌──────────┐    ┌──────────────┐    ┌───────────┐    ┌─────────────┐
│  Browser │    │  Next.js API │    │ BetterAuth│    │  Postgres   │
└────┬─────┘    └──────┬───────┘    └─────┬─────┘    └──────┬──────┘
     │                 │                  │                 │
     │  Request with   │                  │                 │
     │  session cookie │                  │                 │
     ├────────────────►│                  │                 │
     │                 │                  │                 │
     │                 │  getSession()    │                 │
     │                 ├─────────────────►│                 │
     │                 │                  │                 │
     │                 │                  │  Query          │
     │                 │                  │  auth_sessions  │
     │                 │                  ├────────────────►│
     │                 │                  │                 │
     │                 │                  │  User data      │
     │                 │                  │◄────────────────┤
     │                 │                  │                 │
     │                 │  { user: ... }   │                 │
     │                 │◄─────────────────┤                 │
     │                 │                  │                 │
     │  Response       │                  │                 │
     │◄────────────────┤                  │                 │
     │                 │                  │                 │
```

#### Container JWT Authentication

```
┌──────────────┐    ┌───────────────────┐    ┌──────────────┐
│  Container   │    │  Ingress Handler  │    │  JWT Module  │
└──────┬───────┘    └─────────┬─────────┘    └──────┬───────┘
       │                      │                     │
       │  WebSocket upgrade   │                     │
       │  Authorization:      │                     │
       │  Bearer <jwt>        │                     │
       ├─────────────────────►│                     │
       │                      │                     │
       │                      │  verifySessionJwt   │
       │                      ├────────────────────►│
       │                      │                     │
       │                      │  Check:             │
       │                      │  - Signature valid  │
       │                      │  - Not expired      │
       │                      │  - session_id match │
       │                      │                     │
       │                      │  SessionJwtPayload  │
       │                      │◄────────────────────┤
       │                      │                     │
       │  Connection accepted │                     │
       │◄─────────────────────┤                     │
       │                      │                     │
```

---

## Database Schema Reference

### Core Tables

```prisma
model User {
  id                   String    @id @default(uuid()) @db.Uuid
  email                String    @unique
  name                 String?
  emailVerified        Boolean   @default(false)
  githubInstallationId String?

  // Provider settings
  provider               Provider @default(hosted)
  anthropicApiKeyEnc     String?  // BYOK mode
  anthropicSessionKeyEnc String?  // Debug mode
  anthropicOrgUuid       String?  // Debug mode

  sessions     Session[]
  environments Environment[]
  accounts     Account[]
  authSessions AuthSession[]
}

model Session {
  id              String        @id @db.Uuid
  title           String        @default("")
  environmentId   String        @db.Uuid
  userId          String?       @db.Uuid
  status          SessionStatus @default(idle)
  type            String        @default("internal_session")
  providerMode    Provider      @default(hosted)
  sessionContext  Json          // SessionContext shape
  lastEventUuid   String?       @db.Uuid
  containerId     String?       // Docker container name
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  environment     Environment   @relation(...)
  user            User?         @relation(...)
  events          Event[]
}

model Event {
  id              String      @id @default(uuid()) @db.Uuid
  sessionId       String      @db.Uuid
  type            String      // user, assistant, tool_use, etc.
  subtype         String?
  status          EventStatus @default(pending)
  data            Json        // Full event payload
  parentToolUseId String?
  sequenceNum     Int
  createdAt       DateTime    @default(now())

  session         Session     @relation(...)
}

model Environment {
  id        String   @id @db.Uuid
  name      String
  kind      String   @default("local")  // local, anthropic_cloud, kubernetes
  state     String   @default("active")
  configEnc String?  // Encrypted EnvironmentConfig
  userId    String   @db.Uuid

  sessions  Session[]
  user      User     @relation(...)
}
```

### Enums

```prisma
enum SessionStatus {
  idle        // No container running
  running     // Container active
  paused      // Reserved for future use
  completed   // Task completed successfully
  failed      // Task failed
  archived    // User archived
  deleted     // Soft deleted
}

enum EventStatus {
  pending     // Event not yet sent to container
  sent        // Event delivered to container
}

enum Provider {
  hosted      // Server's API key
  byok        // User's API key
  debug       // Direct to Anthropic
}
```

---

## Configuration Reference

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://...
JWT_SECRET=<base64, min 44 chars>
ENCRYPTION_SECRET=<base64, min 44 chars>
BETTER_AUTH_SECRET=<base64, min 44 chars>

# Anthropic (for hosted mode)
PROXY_ANTHROPIC_API_KEY=sk-ant-api03-...

# URLs
DEPLOY_URL=https://example.com
API_URL_FOR_DOCKER_CONTAINERS=http://host.docker.internal:3000  # Dev

# Optional
LOG_LEVEL=info
ALLOWED_WS_ORIGINS=https://example.com,https://app.example.com
RESEND_API_KEY=<for email>
```

### Config Object

```typescript
// From src/config.ts

export const config = {
  isDev: env.NODE_ENV !== "production",
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  encryptionSecret: env.ENCRYPTION_SECRET,
  anthropicApiKey: env.PROXY_ANTHROPIC_API_KEY,
  logLevel: env.LOG_LEVEL,
  anthropicApiUrl: "https://api.anthropic.com",
  deployUrl: env.DEPLOY_URL,
  apiUrlForDockerContainers: env.API_URL_FOR_DOCKER_CONTAINERS ?? env.DEPLOY_URL,
  allowedWsOrigins:
    env.ALLOWED_WS_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? [],
}
```
