-- AlterTable
ALTER TABLE "TrendSyncJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "VolumeDiscountCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "cartToken" TEXT NOT NULL,
    "discountNodeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeDiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolumeDiscountCode_expiresAt_idx" ON "VolumeDiscountCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VolumeDiscountCode_shop_cartToken_key" ON "VolumeDiscountCode"("shop", "cartToken");
