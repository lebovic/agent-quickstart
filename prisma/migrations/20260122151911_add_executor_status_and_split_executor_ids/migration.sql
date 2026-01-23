-- CreateEnum
CREATE TYPE "ExecutorStatus" AS ENUM ('spawning');

-- AlterTable: Add new columns
ALTER TABLE "sessions"
ADD COLUMN "executor_status" "ExecutorStatus",
ADD COLUMN "docker_container_name" TEXT,
ADD COLUMN "modal_sandbox_id" TEXT,
ADD COLUMN "modal_snapshot_id" TEXT;

-- Migrate container_id data to appropriate columns based on environment kind
UPDATE "sessions" s
SET "docker_container_name" = s."container_id"
FROM "environments" e
WHERE s."environment_id" = e."id"
  AND e."kind" = 'docker'
  AND s."container_id" IS NOT NULL;

UPDATE "sessions" s
SET "modal_sandbox_id" = s."container_id"
FROM "environments" e
WHERE s."environment_id" = e."id"
  AND e."kind" = 'modal'
  AND s."container_id" IS NOT NULL;

-- Drop old column
ALTER TABLE "sessions" DROP COLUMN "container_id";
