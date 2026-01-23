/**
 * Executor abstraction layer.
 * Routes call these functions instead of docker.ts directly.
 * Dispatches to the appropriate executor based on environment.kind.
 */

import { type Prisma } from "@prisma/client"
import { spawnContainer, stopSessionContainer, removeSessionContainer } from "./docker"
import { spawnSandbox, stopSessionSandbox, removeSessionSandbox } from "./modal"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

/** Session with environment relation included */
export type SessionWithEnvironment = Prisma.SessionGetPayload<{
  include: { environment: true }
}>

/**
 * Spawns a container/executor for a session.
 * Uses atomic database locking via executorStatus to prevent concurrent spawns.
 */
export async function spawnSession(session: SessionWithEnvironment): Promise<void> {
  const sessionId = session.id

  // Atomically claim the spawn lock by setting executorStatus to 'spawning'
  // Only succeeds if executorStatus is currently null
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      executorStatus: null,
    },
    data: {
      executorStatus: "spawning",
    },
  })

  if (result.count === 0) {
    // Another node is already spawning this session
    log.debug({ sessionId }, "Spawn already in progress on another node, skipping")
    return
  }

  try {
    if (session.environment.kind === "docker") {
      await spawnContainer(session)
      return
    }

    if (session.environment.kind === "modal") {
      await spawnSandbox(session)
      return
    }

    throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
  } finally {
    // Release the spawn lock
    await prisma.session.update({
      where: { id: sessionId },
      data: { executorStatus: null },
    })
  }
}

/**
 * Stops a session's container/executor. Used when archiving.
 */
export async function stopSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "docker") {
    await stopSessionContainer(session)
    return
  }

  if (session.environment.kind === "modal") {
    await stopSessionSandbox(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}

/**
 * Removes a session's container/executor. Used when deleting.
 */
export async function removeSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "docker") {
    await removeSessionContainer(session)
    return
  }

  if (session.environment.kind === "modal") {
    await removeSessionSandbox(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}
