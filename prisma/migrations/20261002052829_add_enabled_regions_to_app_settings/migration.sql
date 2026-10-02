-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "enabledRegions" TEXT[] DEFAULT ARRAY['nz', 'au', 'sg']::TEXT[];
