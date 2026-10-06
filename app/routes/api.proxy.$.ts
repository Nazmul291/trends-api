import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import type { Region, ApiProxyResponse, ProductData, ProductListData, ProductShowData } from "../../shared/types/trends.types";
import { normalizePricing } from "../../shared/types/trends.types";
import { cacheAdapter, CacheKeyBuilder, DEFAULT_CACHE_CONFIG } from "../../server/cache";
import { TrendsApiClient } from "../../server/api-client/trends-client";
import {
  syncTrendProductToShopify,
  deleteTrendProductFromShopify,
  getTrendProductSyncStatuses,
  buildVariantSpecs,
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

  // Initialization step for the Settings page "Sync All" flow: paginates the
  // Trends catalog to build the full list of product codes, WITHOUT syncing any
  // of them — actual syncing happens one product at a time, driven by the browser,
  // via repeated POSTs to "sync-product" (itself falling back to "sync-chunk" per
  // product if QStash is unavailable). This keeps a single request fast (read-only
  // catalog paging) while never attempting the full bulk sync in one invocation.
  if (endpoint === "sync-all-init") {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50; // safety cap: up to 5,000 products per Sync All click
    const productIds: string[] = [];
    const products: Array<{ code: string; name: string }> = [];

    let page = 1;
    let totalPages = 1;
    try {
      do {
        const listRes = await TrendsApiClient.request<ProductListData>(
          region,
          `products?page_no=${page}&page=${page}&page_size=${PAGE_SIZE}&inc_discontinued=false`,
          { settings: appSettings }
        );
        const pageProducts = Array.isArray(listRes.data?.data) ? listRes.data.data : [];
        for (const p of pageProducts) {
          if (!p?.code) continue;
          productIds.push(String(p.code));
          products.push({ code: String(p.code), name: p.name || String(p.code) });
        }

        const responseTotalItems = listRes.data?.total_items;
        totalPages = Math.max(
          1,
          listRes.data?.page_count || (responseTotalItems ? Math.ceil(responseTotalItems / PAGE_SIZE) : 1)
        );
        page += 1;
      } while (page <= totalPages && page <= MAX_PAGES);
    } catch (catalogErr) {
      console.error("[ProxyAction] sync-all-init: failed to page Trends catalog:", catalogErr);
      return Response.json(
        { success: false, error: "Failed to load product catalog for Sync All" },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      region,
      totalProducts: productIds.length,
      productIds,
      products,
      batchSize: 1,
      truncated: totalPages > MAX_PAGES,
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

      // Resolve the full product payload up front (not deferred to the worker) —
      // we need it either way: to hand to QStash, and to compute the variant
      // chunk plan if QStash dispatch fails and we fall back to client-driven sync.
      if (!productToSync) {
        try {
          const showRes = await TrendsApiClient.request<ProductShowData>(
            region,
            `products/${trendsCode}`,
            { settings: appSettings }
          );
          const rawShow = showRes.data?.data;
          productToSync = Array.isArray(rawShow) ? rawShow[0] : rawShow;
        } catch (fetchErr) {
          console.warn(`[ProxyAction] Could not pre-fetch product ${trendsCode}:`, fetchErr);
        }
      }
      if (!productToSync) {
        productToSync = {
          code: trendsCode,
          name: `Product ${trendsCode}`,
          description: "",
          categories: [],
          images: [],
          stock: [],
          pricing: [],
        } as ProductData;
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
      const syncWorkerUrl = resolveSyncWorkerUrl();
      console.info(`[ProxyAction] Job ${job.id}: publishing to QStash worker URL: ${syncWorkerUrl}`);

      try {
        const publishRes = await getQStashClient().publishJSON({
          url: syncWorkerUrl,
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

        // publishJSON resolving does NOT mean the worker ran (or even that the URL
        // is reachable) — it only means QStash accepted the message for delivery.
        // Log the messageId so it can be cross-referenced against delivery/retry
        // status in the Upstash QStash console if the worker never appears to fire.
        console.info(
          `[ProxyAction] Job ${job.id}: QStash accepted message ${publishRes.messageId} ` +
            `(url: ${publishRes.url}, deduplicated: ${Boolean(publishRes.deduplicated)})`
        );
      } catch (publishErr) {
        // QStash dispatch failed (quota exhausted, auth/signing misconfiguration,
        // network/service outage, etc). Don't fail the request — fall back to a
        // client-orchestrated chunked sync so the user's click still makes progress.
        const publishMessage =
          publishErr instanceof Error ? publishErr.message : "Failed to queue sync job with QStash";
        console.warn(
          `[ProxyAction] Job ${job.id}: QStash dispatch failed, falling back to client-driven chunk sync:`,
          publishMessage
        );

        const CHUNK_SIZE = 10;
        const { specs } = buildVariantSpecs(productToSync, region, trendsCode);
        const totalVariants = Math.max(1, specs.length);

        await prisma.trendSyncJob.update({
          where: { id: job.id },
          data: {
            status: "IN_PROGRESS",
            stage: "STAGE_1_PRODUCT_VARIANTS",
            progress: 5,
            message: `Background queue unavailable (${publishMessage}) — syncing via browser-driven chunks instead.`,
          },
        });

        return Response.json(
          {
            success: true,
            mode: "client_chunk",
            jobId: job.id,
            productId: trendsCode,
            trendsCode,
            region,
            totalVariants,
            chunkSize: CHUNK_SIZE,
            productToSync,
            syncLocks: body.syncLocks,
            isMock: body.isMock,
            inventorySyncMode: body.inventorySyncMode,
            targetLocationId: body.targetLocationId,
            splitLocationIds: body.splitLocationIds,
            status: "IN_PROGRESS",
            stage: "STAGE_1_PRODUCT_VARIANTS",
            progress: 5,
            message: "QStash unavailable — syncing this product in chunks from your browser.",
            timestamp: new Date().toISOString(),
          },
          { status: 200 }
        );
      }

      // 3. Return immediate HTTP 202 Accepted (< 500ms) with job ID
      return Response.json(
        {
          success: true,
          mode: "background",
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

  // Processes one bounded slice of a product's variant matrix. Used exclusively by
  // the client-driven chunk fallback (see "sync-product" above): the browser calls
  // this repeatedly with increasing `offset` until `hasMore` is false, so a product
  // with many variants completes across several short requests instead of one that
  // risks running past Vercel's execution ceiling. Each call still fully syncs
  // product-level fields (title, description, channel publication) — only the
  // variant matrix itself is bounded to [offset, offset + limit).
  if (endpoint === "sync-chunk") {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        jobId?: string;
        productId?: string;
        trendsCode?: string;
        product?: ProductData;
        productToSync?: ProductData;
        offset?: number;
        limit?: number;
        syncLocks?: string[];
        isMock?: boolean;
        inventorySyncMode?: "single" | "split_equal";
        targetLocationId?: string | null;
        splitLocationIds?: string[];
      };

      const trendsCode = String(body.trendsCode || body.productId || "").trim();
      const productToSync = body.productToSync || body.product;
      const jobId = body.jobId;
      const offset = Math.max(0, Number(body.offset) || 0);
      const limit = Math.max(1, Number(body.limit) || 10);

      if (!trendsCode || !productToSync || !jobId) {
        return Response.json(
          { success: false, error: "Missing jobId, trendsCode, or productToSync for chunk sync" },
          { status: 400 }
        );
      }

      const chunkResult = await syncTrendProductToShopify({
        admin: adminClient,
        shop,
        trendsProduct: productToSync,
        region,
        syncLocks: body.syncLocks,
        isMock: body.isMock,
        inventorySyncMode: body.inventorySyncMode,
        targetLocationId: body.targetLocationId,
        splitLocationIds: body.splitLocationIds,
        variantOffset: offset,
        variantLimit: limit,
      });

      const processedCount = chunkResult.skuList.length;
      const totalVariants = Math.max(1, chunkResult.totalVariantCount);
      const nextOffset = offset + limit;
      const hasMore = nextOffset < totalVariants;
      const progress = Math.min(99, Math.round((Math.min(nextOffset, totalVariants) / totalVariants) * 90) + 5);

      // chunkResult.success only means the pipeline didn't throw — Shopify's bulk
      // variant mutations return partial success with userErrors instead of
      // throwing, so verify this slice's variants actually landed in Shopify
      // before reporting progress/completion. A shortfall here stops the loop
      // (further chunks of the same broken option/SKU won't help) and fails the
      // job instead of silently under-reporting.
      const expectedThisChunk = Math.min(limit, Math.max(0, totalVariants - offset));
      // Only meaningful when we actually attempted real Shopify calls — skip for
      // the offline/mock path (no admin client), which never has real GIDs.
      const shortfall = adminClient ? expectedThisChunk - chunkResult.actualVariantCount : 0;
      const isFailure = shortfall > 0;

      const failureMsg = isFailure
        ? `Only ${chunkResult.actualVariantCount} of ${expectedThisChunk} variants in this chunk ` +
          `(offset ${offset}) were actually created in Shopify. ${chunkResult.message}`
        : null;

      await prisma.trendSyncJob.update({
        where: { id: jobId },
        data: isFailure
          ? {
              status: "FAILED",
              stage: "FAILED",
              progress: 0,
              errorMessage: failureMsg,
              message: failureMsg,
              result: chunkResult as any,
            }
          : hasMore
          ? {
              status: "IN_PROGRESS",
              stage: "STAGE_1_PRODUCT_VARIANTS",
              progress,
              message: `Synced variants ${offset + 1}-${Math.min(nextOffset, totalVariants)} of ${totalVariants}...`,
            }
          : {
              status: "COMPLETED",
              stage: "COMPLETED",
              progress: 100,
              message: chunkResult.message,
              result: chunkResult as any,
            },
      });

      return Response.json({
        success: true,
        jobId,
        trendsCode,
        region,
        shopifyProductId: chunkResult.shopifyProductId,
        shopifyHandle: chunkResult.shopifyHandle,
        processedCount,
        offset,
        limit,
        nextOffset: isFailure || !hasMore ? null : nextOffset,
        totalVariants,
        hasMore: isFailure ? false : hasMore,
        progress: isFailure ? 0 : hasMore ? progress : 100,
        status: isFailure ? "FAILED" : hasMore ? "IN_PROGRESS" : "COMPLETED",
        error: failureMsg || undefined,
        message: isFailure
          ? failureMsg
          : hasMore
          ? `Synced variants ${offset + 1}-${Math.min(nextOffset, totalVariants)} of ${totalVariants}`
          : chunkResult.message,
      });
    } catch (chunkErr: unknown) {
      const message = chunkErr instanceof Error ? chunkErr.message : "Chunk sync failed";
      console.error(`[ProxyAction] sync-chunk failed:`, chunkErr);
      return Response.json({ success: false, error: message }, { status: 500 });
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
