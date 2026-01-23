import { ModalClient, type Sandbox, type Image as ModalImage } from "modal"
import { type Session } from "@prisma/client"
import { config } from "@/config"
import { log } from "@/lib/logger"
import { prisma } from "@/lib/db"
import { SessionContext } from "@/lib/schemas/session"
import { decryptConfig } from "@/lib/schemas/environment"
import { buildSessionCommands } from "./session-commands"
import type { SessionWithEnvironment } from "./index"

// Cleanup idle sessions every minute
const CLEANUP_INTERVAL_MS = 60 * 1000
// Sessions idle for more than 5 minutes are stopped
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
// Retry delay when sandbox is being snapshotted
const SNAPSHOT_RETRY_DELAY_MS = 2000
// Maximum retries for snapshot race condition
const MAX_SNAPSHOT_RETRIES = 3

let cleanupIntervalId: NodeJS.Timeout | null = null
let modalClient: ModalClient | null = null

/**
 * Get or create the Modal client singleton.
 */
function getModalClient(): ModalClient {
  if (!modalClient) {
    if (!config.modal) {
      throw new Error("Modal is not configured. Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.")
    }
    modalClient = new ModalClient({
      tokenId: config.modal.tokenId,
      tokenSecret: config.modal.tokenSecret,
    })
  }
  return modalClient
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Spawns or restarts a Modal sandbox for a session.
 * If session.modalSandboxId exists, attempts to reuse the existing sandbox.
 * If session has a modalSnapshotId, creates sandbox from that snapshot.
 * Otherwise creates a fresh sandbox.
 *
 * Handles race condition where sandbox may be mid-snapshot by retrying.
 */
export async function spawnSandbox(session: SessionWithEnvironment, retryCount = 0): Promise<void> {
  const sessionId = session.id
  const contextResult = SessionContext.safeParse(session.sessionContext)

  if (!contextResult.success) {
    log.error({ sessionId }, "Invalid session context during sandbox spawn")
    throw new Error("Invalid session context")
  }

  const context = contextResult.data
  const envConfig = decryptConfig(session.environment.configEnc)
  const environmentVariables = envConfig?.environment

  const modal = getModalClient()
  const appName = config.modal?.appName ?? "agent-quickstart"

  // Check if sandbox already exists - try to reuse it
  if (session.modalSandboxId) {
    try {
      const existingSandbox = await modal.sandboxes.fromId(session.modalSandboxId)
      log.info({ sessionId, sandboxId: session.modalSandboxId }, "Reusing existing sandbox")

      // Kill any existing Claude processes before starting a new one
      try {
        const kill = await existingSandbox.exec(["/bin/bash", "-c", "pkill -f 'claude' || true"])
        await kill.wait()
      } catch {
        // Ignore errors from pkill
      }

      const { setupCmd, claudeCmd, workDir, env } = buildSessionCommands(session, context, environmentVariables)

      // Run setup commands (e.g., git checkout to refresh branch)
      if (setupCmd) {
        const setup = await existingSandbox.exec(["/bin/bash", "-c", setupCmd], {
          timeoutMs: 120000,
          env,
        })
        const exitCode = await setup.wait()
        if (exitCode !== 0) {
          const stderr = await setup.stderr.readText()
          log.error({ sessionId, exitCode, stderr }, "Setup commands failed")
          throw new Error(`Setup commands failed with exit code ${exitCode}`)
        }
      }

      // Run Claude CLI
      log.debug({ sessionId, claudeCmd, workDir }, "Starting Claude CLI in existing sandbox")
      existingSandbox.exec(["/bin/bash", "-c", `cd ${workDir} && ${claudeCmd}`], {
        timeoutMs: 3600000,
        env,
      })

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: "running" },
      })

      log.info({ sessionId, sandboxId: session.modalSandboxId }, "Claude CLI started in existing sandbox")
      return
    } catch (err) {
      // Sandbox doesn't exist or can't be accessed
      // Check if we have a snapshot to resume from (race condition handling)
      const freshSession = await prisma.session.findUnique({ where: { id: sessionId } })
      if (freshSession?.modalSnapshotId && !session.modalSnapshotId) {
        // Snapshot was just created - retry with fresh data
        if (retryCount < MAX_SNAPSHOT_RETRIES) {
          log.warn({ sessionId, retryCount }, "Sandbox disappeared but snapshot exists, retrying after delay")
          await sleep(SNAPSHOT_RETRY_DELAY_MS)
          return spawnSandbox({ ...session, modalSnapshotId: freshSession.modalSnapshotId }, retryCount + 1)
        }
      }
      log.debug({ sessionId, sandboxId: session.modalSandboxId, err }, "Existing sandbox not found, creating new one")
    }
  }

  // Create a new sandbox
  const { setupCmd, claudeCmd, workDir, env } = buildSessionCommands(session, context, environmentVariables)

  // Get or create the app
  const app = await modal.apps.fromName(appName, { createIfMissing: true })

  // Determine base image: use snapshot if available, otherwise use default image
  let baseImage: ModalImage
  if (session.modalSnapshotId) {
    log.info({ sessionId, snapshotId: session.modalSnapshotId }, "Resuming sandbox from filesystem snapshot")
    baseImage = await modal.images.fromId(session.modalSnapshotId)
  } else {
    baseImage = modal.images.fromRegistry(config.defaultSessionImage)
  }

  log.info({ sessionId, model: context.model, appName }, "Creating new Modal sandbox")

  // Create secret from environment variables
  const secret = await modal.secrets.fromObject(env)

  // Create the sandbox
  const sandbox = await modal.sandboxes.create(app, baseImage, {
    secrets: [secret],
    timeoutMs: 60 * 60 * 1000, // 1 hour
    workdir: "/home/user",
  })

  const sandboxId = sandbox.sandboxId

  // Run setup commands synchronously (only if not resuming from snapshot)
  if (setupCmd && !session.modalSnapshotId) {
    log.debug({ sessionId, setupCmd }, "Running setup commands")
    const setup = await sandbox.exec(["/bin/bash", "-c", setupCmd], {
      timeoutMs: 120000, // 2 minutes for setup
    })

    const exitCode = await setup.wait()
    if (exitCode !== 0) {
      const stderr = await setup.stderr.readText()
      log.error({ sessionId, exitCode, stderr }, "Setup commands failed")
      await sandbox.terminate()
      throw new Error(`Setup commands failed with exit code ${exitCode}`)
    }
  }

  // Run Claude CLI
  log.debug({ sessionId, claudeCmd, workDir }, "Starting Claude CLI")
  sandbox.exec(["/bin/bash", "-c", `cd ${workDir} && ${claudeCmd}`], {
    timeoutMs: 3600000, // 1 hour
  })

  // Store sandbox ID in database, clear modalSnapshotId since we're now running
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "running",
      modalSandboxId: sandboxId,
      modalSnapshotId: null,
    },
  })

  log.info({ sessionId, sandboxId }, "Modal sandbox started")
}

/**
 * Snapshots the sandbox filesystem and terminates it.
 * Updates the session with the snapshot ID for later resume.
 */
async function snapshotAndTerminate(session: Session, sandbox: Sandbox): Promise<void> {
  const sessionId = session.id

  try {
    log.info({ sessionId, sandboxId: session.modalSandboxId }, "Snapshotting sandbox filesystem")
    const snapshotImage = await sandbox.snapshotFilesystem()

    // Update session with snapshot ID
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        modalSandboxId: null,
        modalSnapshotId: snapshotImage.imageId,
      },
    })

    log.info({ sessionId, snapshotId: snapshotImage.imageId }, "Sandbox filesystem snapshotted")
  } catch (err) {
    log.error({ sessionId, err }, "Failed to snapshot sandbox filesystem")
  }

  try {
    await sandbox.terminate()
    log.info({ sessionId }, "Sandbox terminated")
  } catch (err) {
    log.error({ sessionId, err }, "Failed to terminate sandbox")
  }
}

/**
 * Stops a session's sandbox. Used when archiving a session.
 * Snapshots the filesystem before terminating so the session can be resumed later.
 */
export async function stopSessionSandbox(session: Session): Promise<void> {
  if (!session.modalSandboxId) {
    return
  }

  try {
    const modal = getModalClient()
    const sandbox = await modal.sandboxes.fromId(session.modalSandboxId)
    await snapshotAndTerminate(session, sandbox)
  } catch (err) {
    // Sandbox doesn't exist - that's fine
    log.debug({ sessionId: session.id, sandboxId: session.modalSandboxId, err }, "Sandbox not found during stop")

    // Clear modalSandboxId since sandbox is gone
    await prisma.session.update({
      where: { id: session.id },
      data: { modalSandboxId: null },
    })
  }
}

/**
 * Removes a session's sandbox. Used when deleting a session.
 * Does not snapshot - just terminates.
 */
export async function removeSessionSandbox(session: Session): Promise<void> {
  if (!session.modalSandboxId) {
    return
  }

  try {
    const modal = getModalClient()
    const sandbox = await modal.sandboxes.fromId(session.modalSandboxId)
    await sandbox.terminate()
    log.info({ sessionId: session.id, sandboxId: session.modalSandboxId }, "Sandbox terminated for deletion")
  } catch (err) {
    // Sandbox doesn't exist - that's fine
    log.debug({ sessionId: session.id, sandboxId: session.modalSandboxId, err }, "Sandbox not found during removal")
  }
}

/**
 * Find and stop Modal sandboxes for sessions that have been idle too long.
 * Only affects sessions with environments of kind "modal".
 */
async function cleanupIdleSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - IDLE_TIMEOUT_MS)

  // Find running sessions with modal environments that have been idle too long
  const idleSessions = await prisma.session.findMany({
    where: {
      status: "running",
      modalSandboxId: { not: null },
      updatedAt: { lt: cutoff },
      environment: { kind: "modal" },
    },
  })

  for (const session of idleSessions) {
    if (!session.modalSandboxId) continue

    log.info({ sessionId: session.id, sandboxId: session.modalSandboxId, updatedAt: session.updatedAt }, "Stopping idle Modal sandbox")

    try {
      const modal = getModalClient()
      const sandbox = await modal.sandboxes.fromId(session.modalSandboxId)
      await snapshotAndTerminate(session, sandbox)
    } catch (err) {
      log.warn({ sessionId: session.id, sandboxId: session.modalSandboxId, err }, "Failed to stop idle Modal sandbox")

      // Clear modalSandboxId since sandbox is likely gone
      await prisma.session.update({
        where: { id: session.id },
        data: { modalSandboxId: null },
      })
    }

    // Update status to idle
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "idle" },
    })
  }

  if (idleSessions.length > 0) {
    log.info({ count: idleSessions.length }, "Cleaned up idle Modal sessions")
  }
}

/**
 * Start the background cleanup job for idle Modal sandboxes.
 * Should be called once when the server starts.
 */
export function startCleanupJob(): void {
  if (cleanupIntervalId) {
    log.warn("Modal cleanup job already running")
    return
  }

  // Only start if Modal is configured
  if (!config.modal) {
    log.info("Modal not configured, skipping Modal cleanup job")
    return
  }

  log.info({ intervalMs: CLEANUP_INTERVAL_MS, idleTimeoutMs: IDLE_TIMEOUT_MS }, "Starting Modal cleanup job")

  cleanupIntervalId = setInterval(() => {
    cleanupIdleSessions().catch((err) => {
      log.error({ err: (err as Error).message }, "Modal cleanup job failed")
    })
  }, CLEANUP_INTERVAL_MS)
}

/**
 * Stop the background cleanup job.
 * Should be called when the server shuts down.
 */
export function stopCleanupJob(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
    log.info("Stopped Modal cleanup job")
  }
}
