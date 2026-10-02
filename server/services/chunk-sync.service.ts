/**
 * Chunked Background Sync Service (Server-only)
 *
 * Implements a stateful, cursor-based chunk sync engine designed specifically
 * for serverless execution environments (e.g. Vercel Cron).
 * Each invocation processes a small, safe slice of the Trends product catalog,
 * updates the database cursor, and gracefully terminates within safe execution limits.
 */

import prisma from "../../app/db.server";
import { unauthenticated } from "../../app/shopify.server";
import { TrendsApiClient } from "../api-client/trends-client";
import { getAppSettings, saveAppSettings, type AppSettingsData } from "../settings/app-settings.service";
import { syncTrendProductToShopify } from "./shopify-sync.service";
import type { Region, ProductListData, ProductData } from "../../shared/types/trends.types";

export interface ChunkSyncResult {
  success: boolean;
  shop: string;
  region: Region;
  processedChunkPage: number;
  nextSyncPage: number;
  totalCatalogPages: number;
  chunkSize: number;
  processedCount: number;
  failedCount: number;
  failedItems: Array<{ code: string; error: string }>;
  status: "idle" | "in_progress" | "completed";
  durationMs: number;
  message: string;
  error?: string;
}

// 10-15 products per chunk keeps serverless execution well within safe 10-second limits
export const DEFAULT_CHUNK_SIZE = 12;

// In-memory concurrency locks per shop
const chunkSyncLocks = new Set<string>();

/**
 * Executes a single chunk synchronization pass for a specific shop.
 */
export async function processSyncChunk(
  shop: string,
  options?: {
    forcedPage?: number;
    chunkSize?: number;
    isManual?: boolean;
  }
): Promise<ChunkSyncResult> {
  const startTime = Date.now();

  // 1. Concurrency Guard
  if (chunkSyncLocks.has(shop)) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      shop,
      region: "au",
      processedChunkPage: 1,
      nextSyncPage: 1,
      totalCatalogPages: 1,
      chunkSize: 0,
      processedCount: 0,
      failedCount: 0,
      failedItems: [],
      status: "in_progress",
      durationMs,
      message: `A sync chunk is already actively processing for shop: ${shop}`,
      error: "CONCURRENT_CHUNK_RUNNING",
    };
  }

  chunkSyncLocks.add(shop);

  try {
    const settings = await getAppSettings(shop);

    // If auto-sync is paused and this isn't a manual trigger, skip gracefully
    if (!settings.autoSyncEnabled && !options?.isManual) {
      const durationMs = Date.now() - startTime;
      return {
        success: true,
        shop,
        region: (settings.enabledRegions[0] || "au") as Region,
        processedChunkPage: settings.currentSyncPage || 1,
        nextSyncPage: settings.currentSyncPage || 1,
        totalCatalogPages: settings.totalCatalogPages || 1,
        chunkSize: 0,
        processedCount: 0,
        failedCount: 0,
        failedItems: [],
        status: "idle",
        durationMs,
        message: `Auto-sync is disabled for shop ${shop}. Chunk execution skipped.`,
      };
    }

    const region = (settings.enabledRegions[0] || "au") as Region;
    const currentPage = Math.max(1, options?.forcedPage ?? settings.currentSyncPage ?? 1);
    const limit = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;

    console.info(
      `[ChunkSync] Starting chunk sync for shop ${shop} (${region}) - Page ${currentPage}, Limit ${limit}`
    );

    // 2. Acquire Shopify Admin API offline client
    let adminClient: any = null;
    try {
      const auth = await unauthenticated.admin(shop);
      adminClient = auth.admin;
    } catch (authErr) {
      console.warn(`[ChunkSync] Notice: Could not acquire offline Shopify Admin session for ${shop}:`, authErr);
    }

    // 3. Query Trends API for the current catalog slice
    const endpoint = `products?page_no=${currentPage}&page=${currentPage}&page_size=${limit}&inc_discontinued=false`;
    const trendsRes = await TrendsApiClient.request<ProductListData>(region, endpoint, { settings });

    const rawData = trendsRes.data?.data;
    const products: ProductData[] = Array.isArray(rawData) ? rawData : [];

    // Calculate total pages from Trends API response metadata
    const responsePageCount = trendsRes.data?.page_count;
    const responseTotalItems = trendsRes.data?.total_items;
    const calculatedTotalPages = responseTotalItems ? Math.ceil(responseTotalItems / limit) : null;
    const totalPages = Math.max(1, responsePageCount || calculatedTotalPages || settings.totalCatalogPages || 1);

    console.info(
      `[ChunkSync] Fetched ${products.length} products on page ${currentPage}/${totalPages} for shop ${shop}`
    );

    // 4. Process each product with isolated fault tolerance
    let processedCount = 0;
    let failedCount = 0;
    const failedItems: Array<{ code: string; error: string }> = [];

    for (const product of products) {
      if (!product || !product.code) continue;

      try {
        await syncTrendProductToShopify({
          admin: adminClient,
          shop,
          trendsProduct: product,
          region,
          inventorySyncMode: settings.inventorySyncMode,
          targetLocationId: settings.targetLocationId,
          splitLocationIds: settings.splitLocationIds,
        });
        processedCount++;
      } catch (itemErr: unknown) {
        failedCount++;
        const errMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
        failedItems.push({ code: product.code, error: errMsg });
        console.warn(`[ChunkSync] Non-fatal error syncing product ${product.code}:`, errMsg);
      }
    }

    // 5. Advance Cursor or Complete Cycle
    let nextSyncPage: number;
    let newCursorStatus: "in_progress" | "completed";

    if (currentPage >= totalPages || products.length === 0) {
      // Completed full catalog cycle -> reset back to page 1
      nextSyncPage = 1;
      newCursorStatus = "completed";
      console.info(`[ChunkSync] ✅ Full catalog cycle completed for shop ${shop}! Resetting cursor to page 1.`);
    } else {
      // Advance to next page for the subsequent cron invocation
      nextSyncPage = currentPage + 1;
      newCursorStatus = "in_progress";
      console.info(
        `[ChunkSync] Chunk completed. Advanced cursor to page ${nextSyncPage}/${totalPages} for next invocation.`
      );
    }

    // 6. Persist cursor progress in database
    await saveAppSettings(shop, {
      currentSyncPage: nextSyncPage,
      totalCatalogPages: totalPages,
      syncCursorStatus: newCursorStatus,
      lastChunkProcessedAt: new Date(),
      lastSyncedAt: new Date(),
      syncStatus: newCursorStatus === "completed" ? "idle" : "in_progress",
      syncErrorMessage:
        failedItems.length > 0
          ? `Chunk page ${currentPage} completed with ${failedCount} item issue(s)`
          : null,
    });

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      shop,
      region,
      processedChunkPage: currentPage,
      nextSyncPage,
      totalCatalogPages: totalPages,
      chunkSize: products.length,
      processedCount,
      failedCount,
      failedItems,
      status: newCursorStatus,
      durationMs,
      message: `Successfully processed page ${currentPage} (${processedCount} succeeded, ${failedCount} failed) in ${durationMs}ms.`,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ChunkSync] Critical exception during chunk sync for shop ${shop}:`, err);

    return {
      success: false,
      shop,
      region: "au",
      processedChunkPage: 1,
      nextSyncPage: 1,
      totalCatalogPages: 1,
      chunkSize: 0,
      processedCount: 0,
      failedCount: 0,
      failedItems: [],
      status: "idle",
      durationMs,
      message: "Sync chunk failed with unhandled exception.",
      error: errorMsg,
    };
  } finally {
    chunkSyncLocks.delete(shop);
  }
}

/**
 * Resets the sync cursor back to page 1 for a shop.
 */
export async function resetSyncCursor(shop: string): Promise<AppSettingsData> {
  console.info(`[ChunkSync] Resetting sync cursor to page 1 for shop: ${shop}`);
  return await saveAppSettings(shop, {
    currentSyncPage: 1,
    syncCursorStatus: "idle",
    syncErrorMessage: null,
  });
}
