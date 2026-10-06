import prisma from "../../app/db.server";
import { unauthenticated } from "../../app/shopify.server";
import {
  syncTrendProductToShopify,
  type SyncProgressUpdate,
  type SyncTrendProductResult,
} from "./shopify-sync.service";
import type { ProductData, Region } from "../../shared/types/trends.types";

export const SYNC_JOB_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes stale threshold

export interface InitiateSyncJobOptions {
  shop: string;
  trendsCode: string;
  region: Region;
  admin?: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
  productToSync: ProductData;
  syncLocks?: string[];
  isMock?: boolean;
  inventorySyncMode?: "single" | "split_equal";
  targetLocationId?: string | null;
  splitLocationIds?: string[];
}

export interface SyncJobResponse {
  id: string;
  shop: string;
  trendsCode: string;
  region: string;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;
  stage: string;
  progress: number;
  message: string | null;
  errorMessage: string | null;
  result: SyncTrendProductResult | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Checks for and marks stale jobs as FAILED if they have exceeded the 2-minute timeout.
 */
export async function expireStaleSyncJobs(shop?: string): Promise<number> {
  const staleThreshold = new Date(Date.now() - SYNC_JOB_TIMEOUT_MS);
  try {
    const staleJobs = await prisma.trendSyncJob.updateMany({
      where: {
        ...(shop ? { shop } : {}),
        status: { in: ["QUEUED", "IN_PROGRESS"] },
        updatedAt: { lt: staleThreshold },
      },
      data: {
        status: "FAILED",
        stage: "FAILED",
        errorMessage: "Sync execution timed out after 2 minutes. Please retry.",
      },
    });
    return staleJobs.count;
  } catch (err) {
    console.warn("[SyncJobService] Error expiring stale jobs:", err);
    return 0;
  }
}

/**
 * Creates and initializes a background sync job in the database.
 * Returns immediately so the caller can return HTTP 202 to the client.
 */
export async function createSyncJob(
  shop: string,
  trendsCode: string,
  region: Region
): Promise<SyncJobResponse> {
  // 1. Proactively expire stale jobs
  await expireStaleSyncJobs(shop);

  // 2. Initialize new job in PostgreSQL
  const job = await prisma.trendSyncJob.create({
    data: {
      shop,
      trendsCode: String(trendsCode),
      region,
      status: "QUEUED",
      stage: "QUEUED",
      progress: 5,
      message: "Sync job queued for background processing",
    },
  });

  return {
    id: job.id,
    shop: job.shop,
    trendsCode: job.trendsCode,
    region: job.region,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    errorMessage: job.errorMessage,
    result: (job.result as unknown as SyncTrendProductResult) || null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

/**
 * Retrieves the status of a sync job by jobId or latest for product code,
 * evaluating stale state guards.
 */
export async function getSyncJobStatus(
  shop: string,
  query: { jobId?: string; productId?: string }
): Promise<SyncJobResponse | null> {
  let job = null;

  if (query.jobId) {
    job = await prisma.trendSyncJob.findUnique({
      where: { id: query.jobId },
    });
  } else if (query.productId) {
    job = await prisma.trendSyncJob.findFirst({
      where: {
        shop,
        trendsCode: String(query.productId),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!job) return null;

  // Stale state guard: Check if job timed out (exceeded 2 minutes in active state)
  const isStale =
    (job.status === "QUEUED" || job.status === "IN_PROGRESS") &&
    Date.now() - new Date(job.updatedAt).getTime() > SYNC_JOB_TIMEOUT_MS;

  if (isStale) {
    job = await prisma.trendSyncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        stage: "FAILED",
        errorMessage: "Sync execution timed out after 2 minutes. Please retry.",
      },
    });
  }

  return {
    id: job.id,
    shop: job.shop,
    trendsCode: job.trendsCode,
    region: job.region,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    errorMessage: job.errorMessage,
    result: (job.result as unknown as SyncTrendProductResult) || null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

/**
 * Executes the sync pipeline in the background and updates database milestones.
 */
export async function executeSyncJobAsync(
  jobId: string,
  options: InitiateSyncJobOptions
): Promise<void> {
  const {
    shop,
    region,
    admin: initialAdmin,
    productToSync,
    syncLocks,
    isMock,
    inventorySyncMode,
    targetLocationId,
    splitLocationIds,
  } = options;

  try {
    // 1. Mark as IN_PROGRESS
    await prisma.trendSyncJob.update({
      where: { id: jobId },
      data: {
        status: "IN_PROGRESS",
        stage: "STAGE_1_PRODUCT_VARIANTS",
        progress: 15,
        message: "Initializing Shopify catalog synchronization...",
      },
    });

    // 2. Ensure Shopify Admin API client
    let admin = initialAdmin;
    if (!admin) {
      try {
        const auth = await unauthenticated.admin(shop);
        admin = auth.admin;
      } catch (authErr) {
        console.warn(`[SyncJobService] unauthenticated.admin fallback failed for shop ${shop}:`, authErr);
      }
    }

    // 3. Execute syncTrendProductToShopify with progress milestones callback
    const syncResult = await syncTrendProductToShopify({
      admin,
      shop,
      trendsProduct: productToSync,
      region,
      syncLocks,
      isMock,
      inventorySyncMode,
      targetLocationId,
      splitLocationIds,
      onProgress: async (update: SyncProgressUpdate) => {
        try {
          await prisma.trendSyncJob.update({
            where: { id: jobId },
            data: {
              stage: update.stage,
              progress: update.progress,
              message: update.message,
            },
          });
        } catch (dbUpdateErr) {
          console.warn(`[SyncJobService] Failed to record progress for job ${jobId}:`, dbUpdateErr);
        }
      },
    });

    // 4. Mark COMPLETED — but only if Shopify actually created every variant.
    // syncTrendProductToShopify can return success: true after a PARTIAL
    // variant create/update (Shopify's bulk mutations return userErrors
    // instead of throwing), so blindly trusting `success` here would report a
    // job as fully synced when, say, only 3 of 29 variants actually made it
    // into Shopify. Compare actualVariantCount against totalVariantCount
    // (this worker always runs the full, unchunked sync) and fail loudly
    // instead of silently under-reporting.
    const isFullySynced = syncResult.actualVariantCount >= syncResult.totalVariantCount;

    if (!isFullySynced) {
      const shortfallMsg =
        `Only ${syncResult.actualVariantCount} of ${syncResult.totalVariantCount} variants were actually ` +
        `created in Shopify for product ${options.trendsCode}. Shopify rejected the rest (see ` +
        `[Shopify Sync Diagnostic] logs for the exact userErrors). ${syncResult.message}`;

      await prisma.trendSyncJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          stage: "FAILED",
          progress: 0,
          errorMessage: shortfallMsg,
          message: shortfallMsg,
          result: syncResult as any,
        },
      });

      console.error(`[SyncJobService] Job ${jobId} for product ${options.trendsCode}: ${shortfallMsg}`);
      return;
    }

    await prisma.trendSyncJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        stage: "COMPLETED",
        progress: 100,
        message: syncResult.message || "Product sync completed successfully.",
        result: syncResult as any,
      },
    });

    console.info(`[SyncJobService] Job ${jobId} successfully completed for product ${options.trendsCode}.`);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Sync execution encountered an unexpected error";
    console.error(`[SyncJobService] Job ${jobId} failed:`, error);

    try {
      await prisma.trendSyncJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          stage: "FAILED",
          progress: 0,
          errorMessage: errorMsg,
          message: `Sync failed: ${errorMsg}`,
        },
      });
    } catch (saveErr) {
      console.error(`[SyncJobService] Failed to persist FAILED status for job ${jobId}:`, saveErr);
    }
  }
}
