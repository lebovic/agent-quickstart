/*
  Warnings:

  - You are about to drop the column `config` on the `environments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "environments" DROP COLUMN "config",
ADD COLUMN     "config_enc" TEXT;
