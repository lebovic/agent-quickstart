/*
  Warnings:

  - Made the column `user_id` on table `environments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `email` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "environments" ALTER COLUMN "kind" SET DEFAULT 'docker',
ALTER COLUMN "user_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "organization_users" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "storage_quota_bytes" BIGINT NOT NULL DEFAULT 104857600,
ADD COLUMN     "storage_used_bytes" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "s3_bucket" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" BIGINT NOT NULL,
    "origin_session_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_s3_bucket_s3_key_key" ON "files"("s3_bucket", "s3_key");

-- CreateIndex
CREATE INDEX "files_origin_session_id_idx" ON "files"("origin_session_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_origin_session_id_fkey" FOREIGN KEY ("origin_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
