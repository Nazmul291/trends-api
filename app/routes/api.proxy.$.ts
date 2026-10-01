import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import type { Region, ApiProxyResponse, ProductData, ProductShowData } from "../../shared/types/trends.types";
import { cacheAdapter, CacheKeyBuilder, DEFAULT_CACHE_CONFIG } from "../../server/cache";
import { TrendsApiClient } from "../../server/api-client/trends-client";
import {
  syncTrendProductToShopify,
  deleteTrendProductFromShopify,
  getTrendProductSyncStatuses,
} from "../../server/services/shopify-sync.service";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Helper to parse region and endpoint path from request
 * Accepts /api/proxy/:region/:endpoint or query ?region=:region
 */
function parseProxyTarget(params: Record<string, string | undefined>, url: URL): {
  region: Region;
  endpoint: string;
} {
  const wildcard = params["*"] || "";
  const segments = wildcard.split("/").filter(Boolean);

  let region: Region = "nz";
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

  const url = new URL(request.url);
  const { region, endpoint } = parseProxyTarget(params, url);

  if (!endpoint) {
    return Response.json(
      { success: false, error: "Missing upstream endpoint path" },
      { status: 400 }
    );
  }

  // Handle Sync Status Ledger Lookup
  if (endpoint === "sync-status" || endpoint.startsWith("sync-status")) {
    const codesParam = url.searchParams.get("codes");
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
    });

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

  const url = new URL(request.url);
  const { region, endpoint } = parseProxyTarget(params, url);

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

  // Handle Shopify Catalog Product Synchronization
  if (endpoint === "sync-product") {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        productId?: string;
        product?: ProductData;
        trendsProduct?: ProductData;
        syncLocks?: string[];
        isMock?: boolean;
      };

      let productToSync = body.product || body.trendsProduct;
      if (!productToSync && body.productId) {
        const showRes = await TrendsApiClient.request<ProductShowData>(region, `products/${body.productId}`);
        productToSync = showRes.data?.data;
      }

      if (!productToSync) {
        return Response.json(
          { success: false, error: "Missing product data or productId for synchronization" },
          { status: 400 }
        );
      }

      const syncResult = await syncTrendProductToShopify({
        admin: adminClient,
        shop,
        trendsProduct: productToSync,
        region,
        syncLocks: body.syncLocks,
        isMock: body.isMock,
      });

      return Response.json({
        success: true,
        region,
        cached: false,
        timestamp: new Date().toISOString(),
        data: syncResult,
      });
    } catch (syncErr: unknown) {
      const message = syncErr instanceof Error ? syncErr.message : "Sync to Shopify failed";
      return Response.json(
        {
          success: false,
          region,
          cached: false,
          timestamp: new Date().toISOString(),
          error: message,
        },
        { status: 500 }
      );
    }
  }

  try {
    const body = await request.json().catch(() => undefined);
    const upstreamRes = await TrendsApiClient.request<unknown>(region, endpoint, {
      method: request.method as "POST" | "PUT" | "DELETE",
      body,
    });

    const response: ApiProxyResponse<unknown> = {
      success: true,
      region,
      cached: false,
      timestamp: new Date().toISOString(),
      data: upstreamRes.data,
    };

    return Response.json(response, { status: upstreamRes.status });
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string; data?: unknown };
    return Response.json(
      {
        success: false,
        region,
        cached: false,
        timestamp: new Date().toISOString(),
        error: errorObj.message || "Upstream mutation failed",
        details: errorObj.data,
      },
      { status: errorObj.status || 500 }
    );
  }
};
