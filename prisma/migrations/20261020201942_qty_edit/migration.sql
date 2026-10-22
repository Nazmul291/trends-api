-- AlterTable
ALTER TABLE "TrendProductSync" ADD COLUMN     "customTierQuantities" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "isCustomTiers" BOOLEAN NOT NULL DEFAULT false;
