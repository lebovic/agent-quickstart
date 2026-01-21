/*
  Warnings:

  - Added the required column `app_slug` to the `github_app_config` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "github_app_config" ADD COLUMN     "app_slug" TEXT NOT NULL;
