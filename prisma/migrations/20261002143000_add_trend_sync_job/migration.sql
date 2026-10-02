-- CreateTable
CREATE TABLE IF NOT EXISTS "TrendSyncJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "trendsCode" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "errorMessage" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrendSyncJob_shop_trendsCode_idx" ON "TrendSyncJob"("shop", "trendsCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrendSyncJob_shop_status_idx" ON "TrendSyncJob"("shop", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrendSyncJob_createdAt_idx" ON "TrendSyncJob"("createdAt");
