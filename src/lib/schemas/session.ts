import { z } from "zod"
import type { Session as PrismaSession } from "@prisma/client"
import { SessionStatus as PrismaSessionStatus } from "@prisma/client"
import { uuidToSessionId, uuidToEnvId } from "@/lib/id"
import { InputEvent } from "@/lib/schemas/event"

export const SessionStatus = z.nativeEnum(PrismaSessionStatus)

export const SessionContext = z.object({
  model: z.string(),
  sources: z.array(
    z.object({
      type: z.literal("git_repository"),
      url: z.string(),
    })
  ),
  outcomes: z.array(
    z.object({
      type: z.literal("git_repository"),
      git_info: z.object({
        type: z.literal("github"),
        repo: z.string(),
        branches: z.array(z.string()),
      }),
    })
  ),
  allowed_tools: z.array(z.string()),
  disallowed_tools: z.array(z.string()),
  cwd: z.string(),
})

export const Session = z.object({
  id: z.string(),
  title: z.string(),
  environment_id: z.string(),
  session_status: SessionStatus,
  session_context: SessionContext,
  created_at: z.string(),
  updated_at: z.string(),
  type: z.literal("internal_session"),
})

export const CreateSessionRequest = z.object({
  title: z.string().optional().default(""),
  environment_id: z.string(),
  session_context: z.object({
    model: z.string(),
    sources: z
      .array(z.object({ type: z.literal("git_repository"), url: z.string() }))
      .optional()
      .default([]),
    outcomes: z
      .array(
        z.object({
          type: z.literal("git_repository"),
          git_info: z.object({
            type: z.literal("github"),
            repo: z.string(),
            branches: z.array(z.string()),
          }),
        })
      )
      .optional()
      .default([]),
    allowed_tools: z.array(z.string()).optional().default([]),
    disallowed_tools: z.array(z.string()).optional().default([]),
    cwd: z.string().optional().default(""),
  }),
  events: z.array(InputEvent).optional(),
})

export const UpdateSessionRequest = z.object({
  title: z.string(),
})

export type SessionStatus = z.infer<typeof SessionStatus>
export type SessionContext = z.infer<typeof SessionContext>
export type Session = z.infer<typeof Session>
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequest>

export function toApiSession(session: PrismaSession): Session {
  return {
    id: uuidToSessionId(session.id),
    title: session.title,
    environment_id: uuidToEnvId(session.environmentId),
    session_status: SessionStatus.parse(session.status),
    type: "internal_session",
    session_context: SessionContext.parse(session.sessionContext),
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString(),
  }
}
