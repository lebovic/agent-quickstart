-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('idle', 'running', 'paused', 'completed', 'failed', 'archived');

-- CreateTable
CREATE TABLE "environments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'local',
    "state" TEXT NOT NULL DEFAULT 'active',
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "environment_id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'idle',
    "type" TEXT NOT NULL DEFAULT 'internal_session',
    "session_context" JSONB NOT NULL,
    "last_event_uuid" UUID,
    "container_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "data" JSONB NOT NULL,
    "parent_tool_use_id" TEXT,
    "sequence_num" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_environment_id_idx" ON "sessions"("environment_id");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "sessions_created_at_idx" ON "sessions"("created_at");

-- CreateIndex
CREATE INDEX "events_session_id_idx" ON "events"("session_id");

-- CreateIndex
CREATE INDEX "events_session_id_sequence_num_idx" ON "events"("session_id", "sequence_num");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
