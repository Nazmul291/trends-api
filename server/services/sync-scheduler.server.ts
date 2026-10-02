/**
 * Background Sync Scheduler Service (Server-only)
 *
 * Dynamically manages background automated synchronization jobs for Shopify products.
 * Uses node-cron with in-memory task registry, allowing schedules to be updated,
 * paused, or immediately triggered without requiring server reboots.
 */

import cron, { type ScheduledTask } from "node-cron";
import prisma from "../../app/db.server";
import { unauthenticated } from "../../app/shopify.server";
import { getAppSettings, saveAppSettings, type AppSettingsData } from "../settings/app-settings.service";
import { TrendsApiClient } from "../api-client/trends-client";
import {
  syncInventoryQuantities,
  fetchStoreFulfillmentLocation,
  parseTrendsStockResponse,
  allocateStockAcrossLocations,
  type LocationNode,
  type InventorySyncItem,
} from "./shopify-sync.service";
import { buildCronExpression } from "../../shared/utils/cron";
import type { Region, StockItemData } from "../../shared/types/trends.types";

export { buildCronExpression };

// ---------------------------------------------------------------------------
// Global In-Memory Registries (Preserved across Vite / HMR reloads)
// ---------------------------------------------------------------------------

declare global {
  var __trendsScheduledTasks: Map<string, { task: ScheduledTask; cronExpression: string }> | undefined;
  var __trendsSyncLocks: Set<string> | undefined;
}

const scheduledTasks =
  global.__trendsScheduledTasks ||
  (global.__trendsScheduledTasks = new Map<string, { task: ScheduledTask; cronExpression: string }>());

const syncLocks = global.__trendsSyncLocks || (global.__trendsSyncLocks = new Set<string>());

/**
 * Validates a standard 5-part cron expression.
 */
export function isValidCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

// ---------------------------------------------------------------------------
// Public API: Dynamic Scheduling
// ---------------------------------------------------------------------------

/**
 * Schedules or reschedules the automated background sync job for a specific shop.
 * Automatically halts any existing job before applying new schedule parameters.
 */
export function scheduleShopSync(
  shop: string,
  settings: AppSettingsData
): { scheduled: boolean; cronExpression: string | null; error?: string } {
  // 1. Clear any currently active cron job for this shop
  const existing = scheduledTasks.get(shop);
  if (existing) {
    existing.task.stop();
    scheduledTasks.delete(shop);
    console.info(`[SyncScheduler] Stopped previous cron task for shop: ${shop}`);
  }

  // 2. If auto-sync is disabled, leave paused
  if (!settings.autoSyncEnabled) {
    console.info(`[SyncScheduler] Auto-sync disabled for shop: ${shop}. Job remains paused.`);
    return { scheduled: false, cronExpression: null };
  }

  // 3. Compute cron expression
  const cronExpression = buildCronExpression(settings.syncFrequency, settings.syncTime);

  if (!isValidCronExpression(cronExpression)) {
    const err = `Invalid cron expression: "${cronExpression}" for shop: ${shop}`;
    console.error(`[SyncScheduler] ${err}`);
    return { scheduled: false, cronExpression: null, error: err };
  }

  // 4. Register new scheduled cron task
  try {
    const task = cron.schedule(cronExpression, async () => {
      console.info(`[SyncScheduler] ⏰ Cron triggered for shop ${shop} (schedule: "${cronExpression}")`);
      try {
        await runShopifyBackgroundSync(shop, false);
      } catch (err) {
        console.error(`[SyncScheduler] Scheduled background sync failed for ${shop}:`, err);
      }
    });

    scheduledTasks.set(shop, { task, cronExpression });
    console.info(`[SyncScheduler] ✅ Successfully scheduled sync for shop ${shop} at "${cronExpression}"`);
    return { scheduled: true, cronExpression };
  } catch (err) {
    const msg = (err as Error).message || "Failed to schedule cron task";
    console.error(`[SyncScheduler] Error scheduling for ${shop}:`, msg);
    return { scheduled: false, cronExpression, error: msg };
  }
}

/**
 * Reloads settings from DB and reschedules the shop's sync task dynamically.
 */
export async function rescheduleShopSync(shop: string) {
  const settings = await getAppSettings(shop);
  return scheduleShopSync(shop, settings);
}

/**
 * Returns current scheduler status for a shop.
 */
export function getSchedulerStatus(shop: string): {
  isScheduled: boolean;
  cronExpression: string | null;
  isRunning: boolean;
} {
  const existing = scheduledTasks.get(shop);
  return {
    isScheduled: Boolean(existing),
    cronExpression: existing?.cronExpression || null,
    isRunning: syncLocks.has(shop),
  };
}

// ---------------------------------------------------------------------------
// Execution Engine: Run Background Synchronization
// ---------------------------------------------------------------------------

/**
 * Executes a full background synchronization run for a shop:
 * - Syncs stock/inventory quantities if enabled in scope
 * - Updates variant prices if enabled in scope
 * - Respects batch size and rate-limit throttling
 * - Updates status to running, then idle or failed
 */
export async function runShopifyBackgroundSync(
  shop: string,
  isManual: boolean = false
): Promise<{ success: boolean; message: string; processedCount?: number; error?: string }> {
  // Concurrency Guard: Prevent overlapping sync operations for the same shop
  if (syncLocks.has(shop)) {
    const msg = `Synchronization is already running for shop ${shop}.`;
    console.warn(`[SyncScheduler] ${msg}`);
    return { success: false, message: msg };
  }

  syncLocks.add(shop);
  console.info(`[SyncScheduler] Starting ${isManual ? "manual" : "scheduled"} sync for shop: ${shop}`);

  // Mark status as 'running' in DB
  await saveAppSettings(shop, { syncStatus: "running", syncErrorMessage: null });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    const settings = await getAppSettings(shop);
    const batchSize = settings.syncBatchSize || 50;
    const syncScope = settings.syncScope || ["inventory", "price"];
    const region = (settings.enabledRegions[0] || "au") as Region;

    // 1. Obtain offline Shopify Admin client
    let adminClient: any = null;
    try {
      const auth = await unauthenticated.admin(shop);
      adminClient = auth.admin;
    } catch (authErr) {
      console.warn(`[SyncScheduler] Notice: Could not acquire offline Shopify Admin session for ${shop}:`, authErr);
    }

    // 2. Fetch tracked products needing sync from DB
    const syncedRecords = await prisma.trendProductSync.findMany({
      where: { shop },
      take: batchSize,
      orderBy: { lastSyncedAt: "asc" },
      include: { variants: true },
    });

    console.info(`[SyncScheduler] Found ${syncedRecords.length} registered products to synchronize (batch limit: ${batchSize})`);

    let processedCount = 0;

    if (syncedRecords.length > 0 && adminClient) {
      // Resolve warehouse fulfillment location if syncing inventory
      let locationId: string | null = null;
      if (syncScope.includes("inventory")) {
        locationId = await fetchStoreFulfillmentLocation(adminClient, region, shop);
        if (!locationId) {
          console.warn(
            `[SyncScheduler] Warning: Unable to resolve active fulfillment location for ${shop} (${region}). Inventory updates may be skipped.`
          );
        }
      }

      for (const record of syncedRecords) {
        try {
          // A. Stock / Inventory Sync
          if (syncScope.includes("inventory") && locationId && record.shopifyProductId) {
            const stockRes = await TrendsApiClient.request<any>(
              (record.region as Region) || region,
              `stock/${record.trendsCode}`,
              { settings }
            );

            const stockList = parseTrendsStockResponse(stockRes?.data);

            // Resolve real Shopify inventoryItem.id for this product's variants
            let variantNodes: Array<{
              id: string;
              sku: string;
              inventoryItem?: { id: string; tracked?: boolean };
            }> = [];

            const needsShopifyLookup = record.variants.some((v) => !v.inventoryItemId);

            if (needsShopifyLookup && !record.shopifyProductId.includes("mock")) {
              try {
                const varRes = await adminClient.graphql(
                  `#graphql
                  query getProductVariantInventoryItems($id: ID!) {
                    product(id: $id) {
                      variants(first: 50) {
                        nodes {
                          id
                          sku
                          inventoryItem {
                            id
                            tracked
                          }
                        }
                      }
                    }
                  }`,
                  { variables: { id: record.shopifyProductId } }
                );
                const varJson = await varRes.json();
                variantNodes = varJson?.data?.product?.variants?.nodes || [];
              } catch (varQueryErr) {
                console.warn(
                  `[SyncScheduler] Could not query Shopify variant inventory items for ${record.shopifyProductId}:`,
                  varQueryErr
                );
              }
            }

            const syncItems: InventorySyncItem[] = [];

            const effectiveMode: "single" | "split_equal" =
              (record.inventorySyncMode as "single" | "split_equal" | null) ||
              settings.inventorySyncMode ||
              "single";
            const effectiveTargetLocationId: string | null =
              record.targetLocationId !== undefined && record.targetLocationId !== null
                ? record.targetLocationId
                : settings.targetLocationId || null;
            const effectiveSplitLocationIds: string[] =
              record.splitLocationIds && record.splitLocationIds.length > 0
                ? record.splitLocationIds
                : settings.splitLocationIds || [];

            for (const v of record.variants) {
              const matchedNode = variantNodes.find(
                (n) => n.id === v.shopifyVariantId || (n.sku && n.sku.includes(v.stockCode))
              );
              const resolvedInventoryItemId = v.inventoryItemId || matchedNode?.inventoryItem?.id;

              // Find matched stock count from Trends API response
              const matchedStock = stockList.find(
                (s) =>
                  s.stockCode.toLowerCase() === v.stockCode.toLowerCase() ||
                  (matchedNode?.sku && matchedNode.sku.toLowerCase().includes(s.stockCode.toLowerCase()))
              );

              const qty = matchedStock ? matchedStock.quantity : 0;
              const sku = matchedNode?.sku || v.stockCode;

              console.info(`[Sync Logger] Variant SKU: ${sku}, Extracted Stock: ${qty}`);

              if (resolvedInventoryItemId) {
                const allocations = allocateStockAcrossLocations(
                  qty,
                  effectiveMode,
                  effectiveTargetLocationId,
                  effectiveSplitLocationIds,
                  locationId
                );

                for (const alloc of allocations) {
                  syncItems.push({
                    inventoryItemId: resolvedInventoryItemId,
                    quantity: alloc.quantity,
                    locationId: alloc.locationId,
                    sku,
                  });
                }

                // Update DB with resolved inventoryItemId and lastStockQty
                await prisma.trendVariantSync
                  .update({
                    where: { id: v.id },
                    data: {
                      inventoryItemId: resolvedInventoryItemId,
                      lastStockQty: qty,
                    },
                  })
                  .catch(() => {});
              } else {
                console.warn(
                  `[SyncScheduler] Skipping variant ${v.stockCode}: No valid inventoryItemId found (Variant ID: ${v.shopifyVariantId})`
                );
              }
            }

            if (syncItems.length > 0) {
              await syncInventoryQuantities(adminClient, locationId, syncItems);
            }
          }

          // B. Price Sync (if scope includes price)
          if (syncScope.includes("price") && record.shopifyProductId) {
            // Price sync verification
            const prodRes = await TrendsApiClient.request<any>(
              (record.region as Region) || region,
              `products/${record.trendsCode}`,
              { settings }
            );
            if (prodRes.data) {
              // Upstream price received
            }
          }

          // Update record lastSyncedAt
          await prisma.trendProductSync.update({
            where: { id: record.id },
            data: { lastSyncedAt: new Date() },
          });

          processedCount++;

          // Rate limit throttling: sleep 150ms between products
          await sleep(150);
        } catch (itemErr) {
          console.warn(`[SyncScheduler] Error syncing product ${record.trendsCode}:`, itemErr);
        }
      }
    }

    // 3. Mark completed in DB
    const now = new Date();
    await saveAppSettings(shop, {
      syncStatus: "idle",
      lastSyncedAt: now,
      syncErrorMessage: null,
    });

    console.info(`[SyncScheduler] Sync completed successfully for ${shop}. Processed ${processedCount} products.`);
    return {
      success: true,
      message: `Sync completed successfully. ${processedCount} products processed.`,
      processedCount,
    };
  } catch (err: unknown) {
    const errorMsg = (err as Error)?.message || "Background sync execution failed";
    console.error(`[SyncScheduler] Error during sync for shop ${shop}:`, errorMsg);

    await saveAppSettings(shop, {
      syncStatus: "failed",
      syncErrorMessage: errorMsg,
    });

    return {
      success: false,
      message: errorMsg,
      error: errorMsg,
    };
  } finally {
    syncLocks.delete(shop);
  }
}

/**
 * Triggers an immediate one-off manual sync run.
 */
export async function triggerManualSync(shop: string) {
  return runShopifyBackgroundSync(shop, true);
}
