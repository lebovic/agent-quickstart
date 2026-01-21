/**
 * Executor abstraction layer.
 * Routes call these functions instead of docker.ts directly.
 * Dispatches to the appropriate executor based on environment.kind.
 */

import { type Prisma } from "@prisma/client"
import { spawnContainer, stopSessionContainer, removeSessionContainer } from "./docker"

/** Session with environment relation included */
export type SessionWithEnvironment = Prisma.SessionGetPayload<{
  include: { environment: true }
}>

/**
 * Spawns a container/executor for a session.
 */
export async function spawnSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "local") {
    await spawnContainer(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}

/**
 * Stops a session's container/executor. Used when archiving.
 */
export async function stopSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "local") {
    await stopSessionContainer(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}

/**
 * Removes a session's container/executor. Used when deleting.
 */
export async function removeSession(session: SessionWithEnvironment): Promise<void> {
  if (session.environment.kind === "local") {
    await removeSessionContainer(session)
    return
  }

  throw new Error(`Unsupported environment kind: ${session.environment.kind}`)
}
