import { readFileSync } from "fs"
import Docker from "dockerode"
import { type Session } from "@prisma/client"
import { config } from "@/config"
import { log } from "@/lib/logger"
import { prisma } from "@/lib/db"
import { SessionContext } from "@/lib/schemas/session"
import { decryptConfig } from "@/lib/schemas/environment"
import { buildSessionCommands } from "./session-commands"
import type { SessionWithEnvironment } from "./index"

/**
 * Create Docker client - connects to remote host if configured, otherwise local socket.
 */
function createDockerClient(): Docker {
  if (config.dockerHost) {
    const { host, port, caCertPath, clientCertPath, clientKeyPath } = config.dockerHost

    const options: Docker.DockerOptions = {
      host,
      port,
      protocol: "https",
    }

    if (caCertPath && clientCertPath && clientKeyPath) {
      options.ca = readFileSync(caCertPath)
      options.cert = readFileSync(clientCertPath)
      options.key = readFileSync(clientKeyPath)
    }

    log.info({ host, port }, "Connecting to remote Docker host")
    return new Docker(options)
  }

  return new Docker()
}

const docker = createDockerClient()

/** Type guard for Docker API errors which include an HTTP status code. */
function isDockerError(err: unknown): err is Error & { statusCode: number } {
  return err instanceof Error && "statusCode" in err && typeof err.statusCode === "number"
}

// Cleanup idle sessions every minute
const CLEANUP_INTERVAL_MS = 60 * 1000
// Sessions idle for more than 5 minutes are stopped
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

let cleanupIntervalId: NodeJS.Timeout | null = null

export type ContainerInfo = {
  dockerContainerName: string
  container: Docker.Container
  sessionId: string
}

const activeContainers = new Map<string, ContainerInfo>()

type ContainerCommands = {
  setupCmd: string // Git setup, clone, checkout commands (empty string if none)
  claudeCmd: string // Claude CLI command
  workDir: string // Working directory for Claude (repo dir or /home/user)
  env: string[] // Environment variables in Docker format (KEY=value)
}

/**
 * Convert environment variables from object to Docker's string array format.
 */
function envToDockerFormat(env: Record<string, string>): string[] {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`)
}

/**
 * Build all commands needed to run Claude in a container.
 * Wraps the shared buildSessionCommands and converts env to Docker format.
 */
function buildContainerCommands(
  session: Session,
  context: SessionContext,
  environmentVariables?: Record<string, string>
): ContainerCommands {
  const commands = buildSessionCommands(session, context, environmentVariables)
  return {
    ...commands,
    env: envToDockerFormat(commands.env),
  }
}

/**
 * Attaches to a container's stdout/stderr streams for logging.
 * Also sets up a wait() call to handle container exit.
 */
async function attachToContainer(sessionId: string, container: Docker.Container, dockerContainerName: string): Promise<ContainerInfo> {
  const info: ContainerInfo = {
    dockerContainerName,
    container,
    sessionId,
  }

  activeContainers.set(sessionId, info)

  // Attach to stdout/stderr for logging
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  })

  // Demux the multiplexed stream into stdout/stderr
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []

  container.modem.demuxStream(
    stream,
    {
      write: (chunk: Buffer) => {
        const data = chunk.toString()
        const lines = data.split("\n").filter(Boolean)
        for (const line of lines) {
          log.debug({ sessionId, source: "stdout" }, line)
        }
        stdoutChunks.push(chunk)
      },
    },
    {
      write: (chunk: Buffer) => {
        const data = chunk.toString()
        const lines = data.split("\n").filter(Boolean)
        for (const line of lines) {
          log.debug({ sessionId, source: "stderr" }, line)
        }
        stderrChunks.push(chunk)
      },
    }
  )

  // Handle container exit asynchronously
  container
    .wait()
    .then(async (result) => {
      const code = result.StatusCode
      log.info({ sessionId, exitCode: code }, "Claude Code container exited")
      activeContainers.delete(sessionId)

      // Update session status - keep dockerContainerName since container still exists
      // Exit codes: 0=success, 143=SIGTERM (graceful stop), 137=SIGKILL
      const newStatus = code === 0 ? "completed" : code === 143 || code === 137 ? "idle" : "failed"
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: newStatus },
      })
    })
    .catch(async (err) => {
      log.error({ sessionId, err: err.message }, "Error waiting for container")
      activeContainers.delete(sessionId)

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: "failed" },
      })
    })

  return info
}

/**
 * Spawns or restarts a Docker container for a session.
 * If session.dockerContainerName exists, attempts to restart the existing container.
 * If container was deleted externally, marks session as failed.
 * Otherwise creates a new container.
 */
export async function spawnContainer(session: SessionWithEnvironment): Promise<ContainerInfo> {
  const sessionId = session.id
  const contextResult = SessionContext.safeParse(session.sessionContext)

  if (!contextResult.success) {
    log.error({ sessionId }, "Invalid session context during container spawn")
    throw new Error("Invalid session context")
  }

  const context = contextResult.data
  const envConfig = decryptConfig(session.environment.configEnc)
  const environmentVariables = envConfig?.environment

  // Check if we have an existing container to restart
  if (session.dockerContainerName) {
    try {
      const container = docker.getContainer(session.dockerContainerName)
      const inspectInfo = await container.inspect()

      if (!inspectInfo.State.Running) {
        // Container is stopped - start it first
        log.info(
          { sessionId, dockerContainerName: session.dockerContainerName, state: inspectInfo.State.Status },
          "Starting stopped container"
        )
        await container.start()
      } else {
        log.info(
          { sessionId, dockerContainerName: session.dockerContainerName },
          "Container already running, killing existing Claude processes"
        )

        // Kill existing Claude processes before starting a new one
        const killExec = await container.exec({
          Cmd: ["/bin/bash", "-c", "pkill -f 'claude' || true"],
          AttachStdout: true,
          AttachStderr: true,
        })
        await killExec.start({ Detach: false })
      }

      // Build fresh config and run setup + Claude
      const { setupCmd, claudeCmd, workDir, env } = buildContainerCommands(session, context, environmentVariables)

      // Run setup commands synchronously to ensure git checkout completes
      if (setupCmd) {
        const setupExec = await container.exec({
          Cmd: ["/bin/bash", "-c", setupCmd],
          Env: env,
          WorkingDir: "/home/user",
          AttachStdout: true,
          AttachStderr: true,
        })
        const setupStream = await setupExec.start({ Detach: false })

        // Collect output for debugging
        const chunks: Buffer[] = []
        setupStream.on("data", (chunk: Buffer) => chunks.push(chunk))

        // Wait for stream to end
        await new Promise<void>((resolve) => setupStream.on("end", resolve))

        // Check exit code and fail if setup didn't succeed
        const { ExitCode: setupExitCode } = await setupExec.inspect()
        if (setupExitCode !== 0) {
          const output = Buffer.concat(chunks).toString()
          log.debug({ sessionId, exitCode: setupExitCode, output }, "Setup commands output")
          throw new Error(`Setup commands failed with exit code ${setupExitCode}`)
        }
      }

      // Run Claude in the repo directory (detached)
      const claudeExec = await container.exec({
        Cmd: ["/bin/bash", "-c", claudeCmd],
        Env: env,
        WorkingDir: workDir,
        AttachStdout: true,
        AttachStderr: true,
      })
      await claudeExec.start({ Detach: true })

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: "running" },
      })

      return attachToContainer(sessionId, container, session.dockerContainerName)
    } catch (err) {
      if (isDockerError(err) && err.statusCode === 404) {
        // Container was deleted externally - fail the session
        log.error(
          { sessionId, dockerContainerName: session.dockerContainerName },
          "Container was deleted externally, marking session as failed"
        )

        await prisma.session.update({
          where: { id: sessionId },
          data: { status: "failed", dockerContainerName: null },
        })

        throw new Error(`Container ${session.dockerContainerName} was deleted externally`)
      }

      // Other error - log and rethrow
      log.error({ sessionId, dockerContainerName: session.dockerContainerName, err }, "Failed to inspect/restart container")
      throw err
    }
  }

  // No existing container - create a new one
  const containerName = `claude-session-${sessionId.slice(0, 8)}`
  const { setupCmd, claudeCmd, workDir, env } = buildContainerCommands(session, context, environmentVariables)

  log.info({ sessionId, model: context.model, containerName }, "Creating new Claude Code container")

  // Block cloud metadata endpoints to prevent SSRF attacks
  const metadataBlackholes: string[] = [
    "169.254.169.254:127.0.0.1", // AWS, GCP, Azure metadata
    "169.254.170.2:127.0.0.1", // AWS ECS task metadata
    "fd00:ec2::254:127.0.0.1", // AWS IPv6 metadata
  ]

  // In development, add host.docker.internal so containers can reach localhost
  const devHosts: string[] = config.isDev ? ["host.docker.internal:host-gateway"] : []

  const container = await docker
    .createContainer({
      name: containerName,
      Image: config.defaultSessionImage,
      Entrypoint: ["/bin/bash"],
      Cmd: ["-c", "sleep infinity"],
      Env: env,
      WorkingDir: "/home/user",
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        ExtraHosts: [...metadataBlackholes, ...devHosts],
      },
    })
    .catch((err) => {
      if (isDockerError(err) && err.statusCode === 409) {
        throw new Error("Container spawn already in progress")
      }
      throw err
    })

  await container.start()

  // Run setup commands synchronously to ensure git checkout completes
  if (setupCmd) {
    const setupExec = await container.exec({
      Cmd: ["/bin/bash", "-c", setupCmd],
      Env: env,
      WorkingDir: "/home/user",
      AttachStdout: true,
      AttachStderr: true,
    })
    const setupStream = await setupExec.start({ Detach: false })

    // Collect output for debugging
    const chunks: Buffer[] = []
    setupStream.on("data", (chunk: Buffer) => chunks.push(chunk))

    // Wait for stream to end
    await new Promise<void>((resolve) => setupStream.on("end", resolve))

    // Check exit code and fail if setup didn't succeed
    const { ExitCode: setupExitCode } = await setupExec.inspect()
    if (setupExitCode !== 0) {
      const output = Buffer.concat(chunks).toString()
      log.debug({ sessionId, exitCode: setupExitCode, output }, "Setup commands output")
      throw new Error(`Setup commands failed with exit code ${setupExitCode}`)
    }
  }

  // Run Claude in the repo directory (detached)
  const claudeExec = await container.exec({
    Cmd: ["/bin/bash", "-c", claudeCmd],
    Env: env,
    WorkingDir: workDir,
    AttachStdout: true,
    AttachStderr: true,
  })
  await claudeExec.start({ Detach: true })

  // Store container ID in database
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "running", dockerContainerName: containerName },
  })

  return attachToContainer(sessionId, container, containerName)
}

export async function stopContainer(sessionId: string): Promise<void> {
  const info = activeContainers.get(sessionId)
  if (!info) {
    log.warn({ sessionId }, "No active container found for session")
    return
  }

  log.info({ sessionId, dockerContainerName: info.dockerContainerName }, "Stopping Claude Code container")

  try {
    // Stop with 5 second timeout (sends SIGTERM, then SIGKILL after timeout)
    await info.container.stop({ t: 5 })
  } catch (err) {
    // 304 means container already stopped - that's fine
    if (isDockerError(err) && err.statusCode === 304) {
      return
    }
    log.error({ sessionId, err }, "Failed to stop container")
    throw err
  }
}

export function getActiveContainer(sessionId: string): ContainerInfo | undefined {
  return activeContainers.get(sessionId)
}

export function getActiveContainerCount(): number {
  return activeContainers.size
}

/**
 * Stops a session's container. Used when archiving a session.
 * Does not throw if container is already stopped or doesn't exist.
 */
export async function stopSessionContainer(session: Session): Promise<void> {
  if (!session.dockerContainerName) {
    return
  }

  try {
    const container = docker.getContainer(session.dockerContainerName)
    await container.stop({ t: 5 })
    log.info({ sessionId: session.id, dockerContainerName: session.dockerContainerName }, "Stopped container")
  } catch (err) {
    // 304 = already stopped, 404 = doesn't exist - both are fine
    if (isDockerError(err) && (err.statusCode === 304 || err.statusCode === 404)) {
      return
    }
    log.error({ sessionId: session.id, dockerContainerName: session.dockerContainerName, err }, "Failed to stop container")
    throw err
  }
}

/**
 * Removes a session's container. Used when deleting a session.
 * Stops it first if running. Does not throw if container doesn't exist.
 */
export async function removeSessionContainer(session: Session): Promise<void> {
  if (!session.dockerContainerName) {
    return
  }

  try {
    const container = docker.getContainer(session.dockerContainerName)
    // Force remove (stops if running)
    await container.remove({ force: true })
    log.info({ sessionId: session.id, dockerContainerName: session.dockerContainerName }, "Removed container")
  } catch (err) {
    // 404 = doesn't exist - that's fine
    if (isDockerError(err) && err.statusCode === 404) {
      return
    }
    log.error({ sessionId: session.id, dockerContainerName: session.dockerContainerName, err }, "Failed to remove container")
    throw err
  }
}

/**
 * Find and stop Docker containers for sessions that have been idle too long.
 * Only affects sessions with environments of kind "docker".
 */
async function cleanupIdleSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - IDLE_TIMEOUT_MS)

  // Find running sessions with local environments that have been idle too long
  const idleSessions = await prisma.session.findMany({
    where: {
      status: "running",
      dockerContainerName: { not: null },
      updatedAt: { lt: cutoff },
      environment: { kind: "docker" },
    },
  })

  for (const session of idleSessions) {
    if (!session.dockerContainerName) continue

    log.info(
      { sessionId: session.id, dockerContainerName: session.dockerContainerName, updatedAt: session.updatedAt },
      "Stopping idle Docker container"
    )

    try {
      const container = docker.getContainer(session.dockerContainerName)
      await container.stop({ t: 5 })
    } catch (err) {
      // 304 means already stopped, 404 means container was removed
      if (isDockerError(err) && (err.statusCode === 304 || err.statusCode === 404)) {
        // Container already stopped or removed - that's fine
      } else {
        log.warn({ sessionId: session.id, dockerContainerName: session.dockerContainerName, err }, "Failed to stop idle Docker container")
      }
    }

    // Keep dockerContainerName - container still exists, just stopped
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "idle" },
    })
  }

  if (idleSessions.length > 0) {
    log.info({ count: idleSessions.length }, "Cleaned up idle Docker sessions")
  }
}

/**
 * Start the background cleanup job for idle Docker containers.
 * Should be called once when the server starts.
 */
export function startCleanupJob(): void {
  if (cleanupIntervalId) {
    log.warn("Docker cleanup job already running")
    return
  }

  log.info({ intervalMs: CLEANUP_INTERVAL_MS, idleTimeoutMs: IDLE_TIMEOUT_MS }, "Starting Docker cleanup job")

  cleanupIntervalId = setInterval(() => {
    cleanupIdleSessions().catch((err) => {
      log.error({ err: (err as Error).message }, "Docker cleanup job failed")
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
    log.info("Stopped Docker cleanup job")
  }
}
