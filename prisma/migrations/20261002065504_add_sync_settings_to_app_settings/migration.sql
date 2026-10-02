-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "syncBatchSize" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "syncErrorMessage" TEXT,
ADD COLUMN     "syncFrequency" TEXT NOT NULL DEFAULT 'daily',
ADD COLUMN     "syncScope" TEXT[] DEFAULT ARRAY['inventory', 'price']::TEXT[],
ADD COLUMN     "syncStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "syncTime" TEXT NOT NULL DEFAULT '02:00';
