/*
  Warnings:

  - You are about to drop the column `markupPercentOverride` on the `TrendProductSync` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AppSettings" ALTER COLUMN "defaultMarkupPercent" SET DEFAULT 35;

-- AlterTable
ALTER TABLE "TrendProductSync" DROP COLUMN "markupPercentOverride",
ADD COLUMN     "tierMarkups" JSONB;
