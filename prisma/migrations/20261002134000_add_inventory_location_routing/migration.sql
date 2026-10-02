-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "inventorySyncMode" TEXT NOT NULL DEFAULT 'single',
ADD COLUMN IF NOT EXISTS "splitLocationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "targetLocationId" TEXT;

-- AlterTable
ALTER TABLE "TrendProductSync" ADD COLUMN IF NOT EXISTS "inventorySyncMode" TEXT,
ADD COLUMN IF NOT EXISTS "splitLocationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "targetLocationId" TEXT;
