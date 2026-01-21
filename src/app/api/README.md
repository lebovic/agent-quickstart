# API Routes

## `/v1/`

Routes under `/v1/` are designed to remain interoperable with the Anthropic API at `api.anthropic.com/v1`. This allows Claude Code and other Anthropic SDK clients to work with minimal configuration changes.

- **`/v1/sessions/`** - Session CRUD (list, create)
- **`/v1/sessions/[id]/`** - Get/update/delete a session
- **`/v1/sessions/[id]/archive`** - Archive a session
- **`/v1/sessions/[id]/events`** - Get session events (messages, tool uses, etc.)
- **`/v1/session_ingress/session/[id]`** - Container registration endpoint; containers call this to get connection info
- **`/v1/environment_providers/`** - Environment provider CRUD
- **`/v1/environment_providers/[id]/create`** - Create a session in a specific environment

## `/anthropic/`

Proxy to the Anthropic API. Used by containers in `hosted` and `byok` modes to make LLM requests without having direct access to API keys. The proxy injects credentials based on the session's provider mode.

## `/auth/`

BetterAuth authentication routes.

- **`/auth/[...all]`** - BetterAuth catch-all handler (login, logout, session, etc.)
- **`/auth/github/`** - Initiates GitHub OAuth flow for GitHub App installation
- **`/auth/github/callback`** - GitHub OAuth callback

## `/settings/`

User settings endpoint. Returns and updates user preferences and stored credentials (e.g., BYOK API key).

## `/code/`

GitHub repository utilities for the session creator UI.

- **`/code/repos`** - List repositories accessible via the user's GitHub App installation
- **`/code/repos/[owner]/[repo]/branches`** - List branches for a repository

## `/github/`

GitHub App utilities.

- **`/github/installation-url`** - Returns the GitHub App installation URL for connecting a GitHub account

## `/git-proxy/`

Git HTTP proxy for containers. Injects GitHub credentials so containers can clone/pull/push without direct access to tokens. Also enforces branch restrictions (containers can only push to session-scoped branches).
