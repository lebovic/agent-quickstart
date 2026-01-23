/**
 * Shared command builders for session executors (Docker, Modal).
 * These build the environment variables and CLI arguments needed to run Claude.
 */

import { type Session } from "@prisma/client"
import { config } from "@/config"
import { log } from "@/lib/logger"
import { uuidToSessionId } from "@/lib/id"
import { type SessionContext } from "@/lib/schemas/session"
import { generateSessionJwt } from "@/lib/auth/jwt"
import { buildGitSetupCommands, buildCloneCommands } from "./git-commands"

export type SessionCommands = {
  setupCmd: string // Git setup, clone, checkout commands (empty string if none)
  claudeCmd: string // Claude CLI command
  workDir: string // Working directory for Claude (repo dir or /home/user)
  env: Record<string, string> // Environment variables as key-value pairs
}

/**
 * Build all commands needed to run Claude in a container/sandbox.
 * Returns setup commands and Claude command separately so they can be run
 * in sequence with proper error handling.
 */
export function buildSessionCommands(
  session: Session,
  context: SessionContext,
  environmentVariables?: Record<string, string>
): SessionCommands {
  const token = generateSessionJwt(session)
  const taggedSessionId = uuidToSessionId(session.id)
  const wsUrl = config.apiUrlForExecutors.replace(/^http/, "ws")

  // Build Claude CLI args
  const args = [
    "--output-format=stream-json",
    "--input-format=stream-json",
    "--verbose",
    "--replay-user-messages",
    `--model=${context.model}`,
    `--sdk-url=${wsUrl}/v1/session_ingress/ws/${taggedSessionId}`,
    `--resume=${config.apiUrlForExecutors}/api/v1/session_ingress/session/${taggedSessionId}`,
  ]

  if (context.allowed_tools.length > 0) {
    args.push(`--allowed-tools=${context.allowed_tools.join(",")}`)
  }

  if (context.disallowed_tools.length > 0) {
    args.push(`--disallowed-tools=${context.disallowed_tools.join(",")}`)
  }

  const env: Record<string, string> = {
    TOKEN: token,
    CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR: "3",
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: token,
    ANTHROPIC_BASE_URL: `${config.apiUrlForExecutors}/api/anthropic`,
    ANTHROPIC_API_KEY: token,
    ...environmentVariables,
  }

  const claudeCmd = `exec 3<<<"$TOKEN" && exec claude ${args.map((a) => `'${a}'`).join(" ")}`

  // Build git setup commands
  const gitSetupCommands = buildGitSetupCommands(config.apiUrlForExecutors)
  const { cloneCommands, workDir } = buildCloneCommands(context.sources, context.outcomes)
  const allSetupCommands = [...gitSetupCommands, ...cloneCommands]
  const setupCmd = allSetupCommands.length > 0 ? allSetupCommands.join(" && ") : ""

  log.debug({ sources: context.sources, outcomes: context.outcomes, setupCmd, workDir }, "Built session commands")

  return { setupCmd, claudeCmd, workDir, env }
}
