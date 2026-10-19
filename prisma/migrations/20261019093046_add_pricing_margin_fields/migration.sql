-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "defaultIncludeSetupInUnitCost" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "defaultMarkupPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "defaultShippingBufferPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0.15;

-- AlterTable
ALTER TABLE "TrendProductSync" ADD COLUMN     "includeSetupInUnitCost" BOOLEAN,
ADD COLUMN     "markupPercentOverride" DOUBLE PRECISION,
ADD COLUMN     "selectedAdditionalCostId" INTEGER,
ADD COLUMN     "shippingBufferOverride" DOUBLE PRECISION;
