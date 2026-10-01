import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import type { Region, ApiProxyResponse } from "../../shared/types/trends.types";
import { cacheAdapter, CacheKeyBuilder, DEFAULT_CACHE_CONFIG } from "../../server/cache";
import { TrendsApiClient } from "../../server/api-client/trends-client";
import { authenticate } from "../shopify.server";

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
  // Optional admin authentication verification (supports embedded App Bridge)
  try {
    await authenticate.admin(request);
  } catch {
    // Pass through if not in Shopify admin frame or running local dev tests
  }

  const url = new URL(request.url);
  const { region, endpoint } = parseProxyTarget(params, url);

  if (!endpoint) {
    return Response.json(
      { success: false, error: "Missing upstream endpoint path" },
      { status: 400 }
    );
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
  try {
    await authenticate.admin(request);
  } catch {
    // Pass through
  }

  const url = new URL(request.url);
  const { region, endpoint } = parseProxyTarget(params, url);

  if (!endpoint) {
    return Response.json(
      { success: false, error: "Missing upstream endpoint path" },
      { status: 400 }
    );
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
