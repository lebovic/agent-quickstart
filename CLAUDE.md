# Claude Code Guidelines

## Architecture Overview

This agent quickstart is a web application that provides a browser-based interface for Claude Code sessions. Users can create sessions that spawn executors (Docker containers or Modal sandboxes) running the Claude Code CLI, with real-time WebSocket communication between the browser and executor.

### Components

```
┌─────────────┐     WebSocket      ┌─────────────────────────────────┐
│   Browser   │◄──────────────────►│  Node.js Server (port 3000)     │
│  (Next.js)  │                    │  ├─ Next.js App (frontend/API)  │
└─────────────┘                    │  └─ WebSocket Server            │
                                   └──────────────┬──────────────────┘
                                                  │
                         ┌────────────────────────┼────────────────────────┐
                         │                        │                        │
                         ▼                        ▼                        ▼
                   ┌──────────┐            ┌────────────┐          ┌─────────────┐
                   │ Postgres │            │  Executor  │          │  Anthropic  │
                   │  (data)  │            │Docker/Modal│          │     API     │
                   └──────────┘            └────────────┘          └─────────────┘
```

Executors can be Docker containers (local socket or remote TLS) or Modal sandboxes. Configure via `DEFAULT_EXECUTOR` environment variable.

### Key Directories

- **`server/`** - Custom Node.js server with WebSocket handling
  - `index.ts` - HTTP server, WebSocket upgrade routing
  - `websocket/session-manager.ts` - Pub/sub hub, manages client/container connections
  - `websocket/client-handler.ts` - Browser WebSocket connections
  - `websocket/ingress-handler.ts` - Container WebSocket connections
  - `websocket/anthropic-proxy.ts` - Debug mode proxy to Anthropic API

- **`src/app/`** - Next.js App Router (pages and API routes)
  - `api/v1/sessions/` - Session CRUD
  - `api/v1/environment_providers/` - Environment management
  - `api/anthropic/` - Proxies requests to Anthropic API
  - `api/git-proxy/` - Git HTTP proxy for container auth

- **`src/lib/`** - Shared libraries
  - `executor/` - Executor abstraction (docker.ts, modal.ts)
  - `auth/` - BetterAuth, JWT handling
  - `crypto/encryption.ts` - AES-256-GCM encryption for secrets
  - `stores/` - Zustand stores for client state

### Data Flow

1. **Session Creation**: User creates session → stored in Postgres → returns session ID
2. **WebSocket Connection**: Browser connects to `/ws/sessions/{id}` → client-handler authenticates
3. **Executor Spawn**: First subscriber triggers executor spawn (Docker container or Modal sandbox) with Claude Code CLI
4. **Ingress Connection**: Executor connects back to `/v1/session_ingress/ws/{id}` → ingress-handler authenticates via JWT
5. **Message Relay**: Browser ↔ Server ↔ Executor, with Postgres NOTIFY for multi-node support
6. **Events Stored**: All events persisted to Postgres for history/resume

### Provider Modes

- **hosted** - Server spawns containers, proxies Anthropic API with server's key
- **byok** - Server spawns containers, user provides their own Anthropic API key
- **debug** - Proxies directly to Anthropic's API

---

## TypeScript

- **Use type narrowing, not casting.** Use discriminated unions and type guards to narrow types. Never use `as` casts to force types.
- **Prefer SDK types.** Before defining custom types, check if the Anthropic SDK already exports what you need (e.g., `ImageBlockParam`, `TextBlockParam`, `Base64ImageSource`, `Model`).
- **Avoid type guards when narrowing inline works.** If you can narrow with a simple `if (x.type === 'foo')` check, do that instead of creating a separate type guard function.
- **No typeof checks for object validation.** Don't use `typeof x === "object"` to validate data. Use Zod schemas or proper type narrowing.
- **Prefer Zod for validation.** Use Zod schemas for all runtime validation (request bodies, env vars, external data). Don't use one-off validation functions from other packages.

## React

- **Prefer shadcn/radix components.** Always use components from `@/components/ui` (Button, Dialog, Popover, etc.) instead of plain HTML elements. They have proper styling, accessibility, and cursor behavior built in.
- **Avoid useEffect when possible.** Prefer event handlers, derived state, or stores over useEffect. If you need to sync state across components, use zustand stores. useEffect should be a last resort.
- **Avoid unnecessary cleanup effects.** If you can use data URLs instead of blob URLs, do that - no cleanup needed. Don't add `useEffect` cleanup just because it seems "proper".
- **Keep it simple.** Don't over-engineer solutions. If a simple approach works, use it.

## Security

- **No SVG uploads.** SVGs can contain malicious scripts. Only allow `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

## API

- **Use static error messages.** Never return dynamic error details (like Zod messages or exception text) in API responses. Use fixed, generic messages.

## Logging

- **Never use console.log/error/warn directly.** Always use the structured logger from `@/lib/logger`.
- **Structured logging only.** Log as objects with consistent fields, not string interpolation. This enables ClickHouse/Datadog/etc. ingestion.
- **Include context.** Always include relevant IDs (sessionId, requestId, etc.) as separate fields, not embedded in messages.

```typescript
// Good
log.info({ sessionId, event: "connected" }, "Client connected")

// Bad
console.log(`Client connected to session ${sessionId}`)
```

## Style

- **Default to Opus.** When offering model selection, default to the most capable model.

## Testing

- **Use Vitest.** Tests live alongside source files as `*.test.ts`.
- **Integration tests hit real DB.** API route tests use actual Prisma/Postgres, not mocks.
- **Clean up test data.** Use `beforeAll`/`afterAll` to create and delete test fixtures.
- **Use Haiku for API tests.** When testing against the Anthropic API, use `claude-haiku-4-5-20251001` to minimize costs.

```bash
npm test        # Watch mode
npm run test:run  # Single run
```

## Prisma

- **Prefer migrations over `db push`.** Use migrations to keep the database in sync with version-controlled migration history.
- **Creating migrations.** After editing `prisma/schema.prisma`, run `npx prisma migrate dev --name description` to generate and apply the migration. For data-only migrations (e.g., updating existing rows), manually add SQL statements to the generated migration file before applying.
- **Applying migrations.** Run `npx prisma migrate deploy` to apply pending migrations (non-interactive, safe for CI/production).
- **Run seed with tsx directly.** Use `npx tsx prisma/seed.ts` instead of `npx prisma db seed` to ensure environment variables are loaded properly.
- **Use Prisma enums for union types.** Define enums in the schema (e.g., `enum Provider { hosted byok debug }`) so types flow through naturally without casts.
- **`sessionContext` is for API parity.** The `sessionContext` JSONB field on sessions exists for interoperability with the Anthropic API. Do not add internal/implementation-specific fields (e.g., executor state, snapshot IDs) to this JSON - use dedicated columns on the sessions table instead.

## Next.js 16

- **Use `proxy.ts`, not `middleware.ts`.** Next.js 16 renamed middleware to proxy. The file must be `src/proxy.ts` and export `proxy` (not `middleware`).
- **No runtime config in proxy.** Don't export `runtime = "nodejs"` in proxy.ts - proxy always runs on Node.js.

## Running

```bash
npm run dev  # Uses custom server with WebSocket proxy on port 3000
docker-compose up -d  # Start Postgres
```

## Executors

Sessions run in executors (Docker containers or Modal sandboxes). Configure which executor to use:

- **`DEFAULT_EXECUTOR`** - Set to `"docker"` (default) or `"modal"`. New environments use this executor type.
- **Docker:** Runs locally or on a remote Docker host. Set `DOCKER_HOST`, `DOCKER_PORT`, and TLS cert paths for remote hosts.
- **Modal:** Cloud sandboxes via Modal. Requires `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`.

### Docker

- Defaults to local Docker socket if `DOCKER_HOST` is not configured.

### Modal

- **Requires public URL.** Set `API_URL_FOR_EXECUTORS` to a URL accessible from Modal's infrastructure. In development, use a tunnel service (ngrok, Cloudflare Tunnel, etc.) to expose your local server.
- **Cold start behavior.** The first few sandbox creations may be slow (~30s) and the first message might fail to send. This self-resolves as the image is cached.

### Claude Code CLI

- **Don't use `--print` with `--sdk-url`.** When running Claude Code with `--sdk-url`, do NOT use `--print`. The `--print` flag is for non-interactive single-prompt mode and will break WebSocket communication.

## Logging Levels

- **DEBUG for trace-level logs.** Use `log.debug` for detailed trace logs (message contents, forwarding, etc.). Don't bump to INFO just for debugging - DEBUG is appropriate.

## Legal Documents

The `/legal/` folder is gitignored and contains Terms of Service and Privacy Policy markdown files:

- `legal/terms-of-service.md` - Terms of Service
- `legal/privacy-policy.md` - Privacy Policy

These are rendered at `/legal/terms` and `/legal/privacy` by the dynamic route at `src/app/legal/[slug]/page.tsx`. If the files don't exist locally, the page shows a fallback message.
