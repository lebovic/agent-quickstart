/*
  Warnings:

  - You are about to drop the column `last_activity_at` on the `sessions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[external_auth_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `external_auth_id` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "last_activity_at";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "external_auth_id" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_external_auth_id_key" ON "users"("external_auth_id");
