import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import type { Region, ApiProxyResponse, ProductData } from "../../shared/types/trends.types";
import { normalizePricing } from "../../shared/types/trends.types";
import { cacheAdapter, CacheKeyBuilder, DEFAULT_CACHE_CONFIG } from "../../server/cache";
import { TrendsApiClient } from "../../server/api-client/trends-client";
import {
  syncTrendProductToShopify,
  deleteTrendProductFromShopify,
  getTrendProductSyncStatuses,
} from "../../server/services/shopify-sync.service";
import {
  createSyncJob,
  getSyncJobStatus,
} from "../../server/services/sync-job.service";
import { getQStashClient, resolveSyncWorkerUrl } from "../../server/services/qstash.service";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../../server/settings/app-settings.service";

/**
 * Helper to parse region and endpoint path from request
 * Accepts /api/proxy/:region/:endpoint or query ?region=:region
 */
function parseProxyTarget(
  params: Record<string, string | undefined>,
  url: URL,
  defaultRegion?: Region
): {
  region: Region | null;
  endpoint: string;
} {
  const wildcard = params["*"] || "";
  const segments = wildcard.split("/").filter(Boolean);

  let region: Region | null = null;
  let endpointSegments = segments;

  if (segments.length > 0 && ["nz", "au", "sg"].includes(segments[0].toLowerCase())) {
    region = segments[0].toLowerCase() as Region;
    endpointSegments = segments.slice(1);
  } else {
    const queryRegion = url.searchParams.get("region");
    if (queryRegion && ["nz", "au", "sg"].includes(queryRegion.toLowerCase())) {
      region = queryRegion.toLowerCase() as Region;
    }
  }

  if (!region && defaultRegion) {
    region = defaultRegion;
  }

  const endpoint = endpointSegments.join("/");
  return { region, endpoint };
}

/**
 * Determines TTL for a given endpoint path
 */
function getEndpointTtl(endpoint: string): number {
  if (endpoint.startsWith("categories")) {
    return DEFAULT_CACHE_CONFIG.categoriesTtl;
  }
  if (endpoint.startsWith("lead-times")) {
    return DEFAULT_CACHE_CONFIG.leadTimesTtl;
  }
  if (endpoint.startsWith("stock")) {
    return DEFAULT_CACHE_CONFIG.stockTtl;
  }
  if (endpoint.startsWith("products")) {
    // Single product (/products/10042) vs list (/products)
    const isSingle = endpoint.split("/").length > 1;
    return isSingle ? DEFAULT_CACHE_CONFIG.productShowTtl : DEFAULT_CACHE_CONFIG.productsListTtl;
  }
  return 0; // Bypass for orders, health, and mutations
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  let shop = "demo.myshopify.com";
  // Optional admin authentication verification (supports embedded App Bridge)
  try {
    const auth = await authenticate.admin(request);
    shop = auth.session.shop;
  } catch {
    const latestSession = await prisma.session.findFirst();
    if (latestSession) {
      shop = latestSession.shop;
    }
  }

  // Load DB-backed settings (falls back to env vars if no record exists)
  const appSettings = await getAppSettings(shop);
  const enabledRegions = (appSettings.enabledRegions || []) as Region[];
  const fallbackRegion: Region = enabledRegions[0] || "au";

  const url = new URL(request.url);
  const target = parseProxyTarget(params, url, fallbackRegion);
  const endpoint = target.endpoint;
  let region: Region = target.region || fallbackRegion;

  // Strictly enforce enabled regions from database settings:
  // If requested region is missing, invalid, or disabled, reassign dynamically to first enabled region.
  if (enabledRegions.length > 0 && !enabledRegions.includes(region)) {
    region = enabledRegions[0];
  }

  if (!endpoint) {
    return Response.json(
      { success: false, error: "Missing upstream endpoint path" },
      { status: 400 }
    );
  }

  // Handle Sync Status Ledger Lookup or Async Job Polling
  if (endpoint === "sync-status" || endpoint.startsWith("sync-status")) {
    const jobId = url.searchParams.get("jobId");
    const productId = url.searchParams.get("productId") || url.searchParams.get("code");
    const codesParam = url.searchParams.get("codes");

    // If polling for a specific background sync job
    if (jobId || (productId && !codesParam)) {
      const jobStatus = await getSyncJobStatus(shop, {
        jobId: jobId || undefined,
        productId: productId || undefined,
      });

      // Also get sync status item from ledger if productId provided
      let syncItem = null;
      if (productId) {
        const syncMap = await getTrendProductSyncStatuses(shop, [String(productId)]);
        syncItem = syncMap[String(productId)] || null;
      }

      return Response.json({
        success: true,
        region,
        shop,
        jobId: jobStatus?.id || jobId || null,
        status: jobStatus?.status || (syncItem?.isSynced ? "COMPLETED" : "IDLE"),
        stage: jobStatus?.stage || (syncItem?.isSynced ? "COMPLETED" : "IDLE"),
        progress: jobStatus?.progress ?? (syncItem?.isSynced ? 100 : 0),
        message: jobStatus?.message || null,
        errorMessage: jobStatus?.errorMessage || null,
        result: jobStatus?.result || null,
        job: jobStatus,
        data: syncItem && productId ? { [String(productId)]: syncItem } : {},
      });
    }

    const codes = codesParam ? codesParam.split(",").map((c) => c.trim()).filter(Boolean) : [];
    const syncMap = await getTrendProductSyncStatuses(shop, codes);
    return Response.json({
      success: true,
      region,
      shop,
      data: syncMap,
    });
  }

  const ttl = getEndpointTtl(endpoint);
  const bypassCache = url.searchParams.get("bypassCache") === "true" || ttl === 0;

  // Build deterministic cache key
  const queryParams = new URLSearchParams(url.searchParams);
  queryParams.delete("region");
  queryParams.delete("bypassCache");

  // Default products catalog endpoint to 50 items per batch/page
  if (endpoint === "products" && !queryParams.has("page_size")) {
    queryParams.set("page_size", "50");
  }

  const cacheKey = CacheKeyBuilder.custom(region, endpoint, queryParams.toString());

  // 1. Check Cache Layer
  if (!bypassCache) {
    const cachedData = await cacheAdapter.get<unknown>(cacheKey);
    if (cachedData !== null) {
      const response: ApiProxyResponse<unknown> = {
        success: true,
        region,
        cached: true,
        cacheTtl: ttl,
        timestamp: new Date().toISOString(),
        data: cachedData,
      };
      return Response.json(response, {
        headers: {
          "X-Cache-Status": "HIT",
          "Cache-Control": `public, s-maxage=${ttl}, stale-while-revalidate=60`,
        },
      });
    }
  }

  // 2. Fetch from upstream TRENDS API
  try {
    const upstreamRes = await TrendsApiClient.request<unknown>(region, endpoint, {
      method: "GET",
      params: queryParams,
      settings: appSettings,
    });

    // If fetching the product catalog list, enrich each product with live/cached stock & normalize pricing
    if (endpoint === "products" && upstreamRes.data && typeof upstreamRes.data === "object") {
      const listData = upstreamRes.data as any;
      if (Array.isArray(listData.data) && listData.data.length > 0) {
        await Promise.all(
          listData.data.map(async (prod: any) => {
            prod.pricing = normalizePricing(prod.pricing);
            if ((!prod.stock || prod.stock.length === 0) && prod.code) {
              try {
                const stockCacheKey = CacheKeyBuilder.stock(region, String(prod.code));
                const cachedStock = await cacheAdapter.get<any[]>(stockCacheKey);
                if (cachedStock && Array.isArray(cachedStock)) {
                  prod.stock = cachedStock;
                } else {
                  const stockRes = await TrendsApiClient.request<any>(region, `stock/${prod.code}`, {
                    settings: appSettings,
                  });
                  const items = stockRes?.data?.data || [];
                  prod.stock = items;
                  if (items.length > 0) {
                    await cacheAdapter.set(stockCacheKey, items, DEFAULT_CACHE_CONFIG.stockTtl);
                  }
                }
              } catch {
                prod.stock = [];
              }
            }
          })
        );
      }
    }

    // If fetching a single product, ensure single-object normalization (upstream returns array)
    if (endpoint.startsWith("products/") && upstreamRes.data && typeof upstreamRes.data === "object") {
      const showData = upstreamRes.data as any;
      if (Array.isArray(showData.data) && showData.data.length > 0) {
        showData.data = showData.data[0];
      }
      if (showData.data && typeof showData.data === "object") {
        showData.data.pricing = normalizePricing(showData.data.pricing);
      }
    }

    // 3. Populate Cache
    if (!bypassCache && ttl > 0 && upstreamRes.data) {
      await cacheAdapter.set(cacheKey, upstreamRes.data, ttl);
    }

    const response: ApiProxyResponse<unknown> = {
      success: true,
      region,
      cached: false,
      cacheTtl: ttl,
      timestamp: new Date().toISOString(),
      data: upstreamRes.data,
      isMockFallback: upstreamRes.isMockFallback,
    };

    return Response.json(response, {
      headers: {
        "X-Cache-Status": "MISS",
        "Cache-Control": ttl > 0 ? `public, s-maxage=${ttl}` : "no-store",
        ...(upstreamRes.isMockFallback ? { "X-Trends-Mock": "true" } : {}),
      },
    });
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string; data?: unknown };
    return Response.json(
      {
        success: false,
        region,
        cached: false,
        timestamp: new Date().toISOString(),
        error: errorObj.message || "Failed to proxy request to TRENDS API",
        details: errorObj.data,
      },
      { status: errorObj.status || 500 }
    );
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  let adminClient: any = undefined;
  let shop = "demo.myshopify.com";

  try {
    const auth = await authenticate.admin(request);
    adminClient = auth.admin;
    shop = auth.session.shop;
  } catch {
    const latestSession = await prisma.session.findFirst();
    if (latestSession) {
      shop = latestSession.shop;
    }
  }

  // Load DB-backed settings (falls back to env vars if no record exists)
  const appSettings = await getAppSettings(shop);
  const enabledRegions = (appSettings.enabledRegions || []) as Region[];
  const fallbackRegion: Region = enabledRegions[0] || "au";

  const url = new URL(request.url);
  const target = parseProxyTarget(params, url, fallbackRegion);
  const endpoint = target.endpoint;
  let region: Region = target.region || fallbackRegion;

  // Strictly enforce enabled regions from database settings:
  // If requested region is missing, invalid, or disabled, reassign dynamically to first enabled region.
  if (enabledRegions.length > 0 && !enabledRegions.includes(region)) {
    region = enabledRegions[0];
  }

  if (!endpoint) {
    return Response.json(
      { success: false, error: "Missing upstream endpoint path" },
      { status: 400 }
    );
  }

  // Handle Product Deletion from Shopify & Sync Ledger
  if (endpoint === "delete-product" || (endpoint === "sync-product" && request.method === "DELETE")) {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        productId?: string;
        trendsCode?: string;
      };

      const trendsCode = body.trendsCode || body.productId;
      if (!trendsCode) {
        return Response.json(
          { success: false, error: "Missing productId or trendsCode for deletion" },
          { status: 400 }
        );
      }

      const deleteResult = await deleteTrendProductFromShopify({
        admin: adminClient,
        shop,
        trendsCode: String(trendsCode),
      });

      return Response.json({
        success: true,
        region,
        data: deleteResult,
      });
    } catch (delErr: unknown) {
      const message = delErr instanceof Error ? delErr.message : "Deletion failed";
      return Response.json(
        {
          success: false,
          region,
          error: message,
        },
        { status: 500 }
      );
    }
  }

  // Handle Shopify Catalog Product Synchronization (Decoupled Background Worker)
  if (endpoint === "sync-product") {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        productId?: string;
        product?: ProductData;
        trendsProduct?: ProductData;
        syncLocks?: string[];
        isMock?: boolean;
        inventorySyncMode?: "single" | "split_equal";
        targetLocationId?: string | null;
        splitLocationIds?: string[];
      };

      let productToSync = body.product || body.trendsProduct;
      if (Array.isArray(productToSync)) {
        productToSync = productToSync[0];
      }

      const trendsCode = String(body.productId || productToSync?.code || "").trim();
      if (!trendsCode) {
        return Response.json(
          { success: false, error: "Missing product data or productId for synchronization" },
          { status: 400 }
        );
      }

      // 1. Initialize background sync job in PostgreSQL immediately
      const job = await createSyncJob(shop, trendsCode, region);

      // 2. Dispatch the job to QStash as a single durable HTTP message targeting our
      // dedicated worker route. QStash (not this request's lifetime) owns retries
      // and delivery guarantees, so the sync survives this function's container
      // freezing right after the response below is sent.
      //
      // Exactly ONE message per product sync — all of that product's variants ride
      // along inside `productToSync`/the worker's own re-fetch, never one message
      // per variant — to stay well under Upstash's free-tier 500 messages/day cap.
      // Retries are capped conservatively (2) for the same reason: transient
      // failures still get one automatic retry, but we don't burn quota chasing
      // deterministic failures.
      try {
        await getQStashClient().publishJSON({
          url: resolveSyncWorkerUrl(),
          retries: 2,
          body: {
            jobId: job.id,
            shop,
            trendsCode,
            region,
            productToSync,
            syncLocks: body.syncLocks,
            isMock: body.isMock,
            inventorySyncMode: body.inventorySyncMode,
            targetLocationId: body.targetLocationId,
            splitLocationIds: body.splitLocationIds,
          },
        });
      } catch (publishErr) {
        const publishMessage =
          publishErr instanceof Error ? publishErr.message : "Failed to queue sync job with QStash";
        console.error(`[ProxyAction] QStash publish failed for job ${job.id}:`, publishErr);

        await prisma.trendSyncJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            stage: "FAILED",
            errorMessage: publishMessage,
            message: `Failed to queue sync job: ${publishMessage}`,
          },
        });

        return Response.json(
          { success: false, jobId: job.id, error: publishMessage },
          { status: 502 }
        );
      }

      // 3. Return immediate HTTP 202 Accepted (< 500ms) with job ID
      return Response.json(
        {
          success: true,
          jobId: job.id,
          productId: trendsCode,
          trendsCode,
          status: "QUEUED",
          stage: "QUEUED",
          progress: 5,
          message: "Product synchronization job initiated successfully in the background.",
          region,
          timestamp: new Date().toISOString(),
        },
        {
          status: 202,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } catch (syncErr: unknown) {
      const message = syncErr instanceof Error ? syncErr.message : "Sync to Shopify failed to initialize";
      return Response.json(
        {
          success: false,
          region,
          error: message,
        },
        { status: 500 }
      );
    }
  }

  // Trends API specification (OpenAPI 3.1.0) is strictly read-only (GET).
  // Block any non-compliant mutations (e.g. POST /orders) to upstream endpoints.
  if (endpoint.startsWith("orders")) {
    return Response.json(
      {
        success: false,
        region,
        error:
          "The Trends API does not support outbound order creation (POST /orders). Orders must be created via distributor purchasing and tracked via GET /api/v1/orders.",
      },
      { status: 405 }
    );
  }

  return Response.json(
    {
      success: false,
      region,
      error: `Method ${request.method} is not supported for upstream Trends endpoint '${endpoint}'. Trends API specification is read-only (GET).`,
    },
    { status: 405 }
  );
};
