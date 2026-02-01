-- AlterTable
ALTER TABLE "files" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Drop the existing unique constraint
DROP INDEX IF EXISTS "files_s3_bucket_s3_key_key";

-- Create partial unique index (only applies to non-deleted files)
CREATE UNIQUE INDEX "files_s3_bucket_s3_key_key" ON "files" ("s3_bucket", "s3_key") WHERE "deleted_at" IS NULL;
