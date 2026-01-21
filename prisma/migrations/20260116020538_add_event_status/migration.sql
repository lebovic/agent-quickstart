-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('pending', 'sent');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "events_session_id_status_idx" ON "events"("session_id", "status");
