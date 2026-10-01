-- CreateTable
CREATE TABLE "TrendProductSync" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "trendsCode" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "syncLocks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendProductSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendVariantSync" (
    "id" TEXT NOT NULL,
    "productSyncId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lastStockQty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendVariantSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendOrderDispatch" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "trendsOrderNum" TEXT,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendOrderDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrendProductSync_shopifyProductId_key" ON "TrendProductSync"("shopifyProductId");

-- CreateIndex
CREATE INDEX "TrendProductSync_shop_trendsCode_idx" ON "TrendProductSync"("shop", "trendsCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrendVariantSync_shopifyVariantId_key" ON "TrendVariantSync"("shopifyVariantId");

-- CreateIndex
CREATE INDEX "TrendVariantSync_stockCode_region_idx" ON "TrendVariantSync"("stockCode", "region");

-- CreateIndex
CREATE UNIQUE INDEX "TrendOrderDispatch_shopifyOrderId_key" ON "TrendOrderDispatch"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "TrendOrderDispatch_shop_status_idx" ON "TrendOrderDispatch"("shop", "status");

-- AddForeignKey
ALTER TABLE "TrendVariantSync" ADD CONSTRAINT "TrendVariantSync_productSyncId_fkey" FOREIGN KEY ("productSyncId") REFERENCES "TrendProductSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;
