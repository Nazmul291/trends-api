-- AlterTable
ALTER TABLE "TrendVariantSync" ADD COLUMN     "inventoryItemId" TEXT;

-- CreateIndex
CREATE INDEX "TrendVariantSync_inventoryItemId_idx" ON "TrendVariantSync"("inventoryItemId");
