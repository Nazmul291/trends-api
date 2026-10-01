import type { Region } from "../../shared/types/trends.types";
import { getRegionalUpstreamConfig } from "./credentials";
import {
  MOCK_CATEGORIES,
  MOCK_LEAD_TIMES,
  getMockProducts,
  getMockSingleProduct,
  getMockStock,
  getMockOrders,
} from "./mock-data";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown> | URLSearchParams;
  body?: unknown;
  timeoutMs?: number;
}

export interface TrendsApiResponse<T> {
  status: number;
  data: T;
  isMockFallback?: boolean;
}

export class TrendsApiClient {
  /**
   * Dispatches request to the regional upstream TRENDS API, or provides fallback mock data if credentials are absent.
   */
  static async request<T>(
    region: Region,
    endpointPath: string,
    options: RequestOptions = {}
  ): Promise<TrendsApiResponse<T>> {
    const { baseUrl, headers, hasCredentials } = getRegionalUpstreamConfig(region);
    const { method = "GET", params, body, timeoutMs = 12000 } = options;

    // Check if fallback to mock data is enabled when credentials are missing
    const allowMockFallback =
      process.env.ENABLE_TRENDS_MOCK_FALLBACK !== "false" &&
      (!hasCredentials || process.env.NODE_ENV !== "production");

    if (!hasCredentials) {
      if (allowMockFallback) {
        console.info(
          `[TRENDS API Proxy] Notice: Using mock fallback data for /${endpointPath} (${region.toUpperCase()}) because credentials are not configured.`
        );
        const mockData = this.resolveMockData<T>(region, endpointPath, options);
        if (mockData !== undefined) {
          return {
            status: 200,
            data: mockData,
            isMockFallback: true,
          };
        }
      }

      throw {
        status: 401,
        message: `Missing TRENDS API credentials for region '${region.toUpperCase()}'. Please configure TRENDS_API_KEY_${region.toUpperCase()} in your .env file.`,
      };
    }

    // Clean up endpoint path and ensure .json format suffix per OpenAPI spec
    let path = endpointPath.replace(/^\//, "");
    if (!path.endsWith(".json") && !path.includes("health")) {
      path = `${path}.json`;
    }

    let url = `${baseUrl}/api/v1/${path}`;

    if (params) {
      const searchParams =
        params instanceof URLSearchParams
          ? params
          : new URLSearchParams(
              Object.entries(params)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => [k, String(v)])
            );

      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes("?") ? "&" : "?") + qs;
      }
    }

    const requestHeaders: Record<string, string> = {
      ...headers,
    };

    if (body) {
      requestHeaders["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      let responseData: T;

      if (contentType.includes("application/json")) {
        responseData = (await res.json()) as T;
      } else {
        const text = await res.text();
        try {
          responseData = JSON.parse(text) as T;
        } catch {
          responseData = text as unknown as T;
        }
      }

      if (!res.ok) {
        if (res.status === 401) {
          throw {
            status: 401,
            message: `TRENDS API upstream returned 401 Unauthorized for region '${region.toUpperCase()}'. Please verify that your API credentials in .env are valid.`,
            data: responseData,
          };
        }

        throw {
          status: res.status,
          message: `TRENDS API request failed with HTTP ${res.status}`,
          data: responseData,
        };
      }

      return {
        status: res.status,
        data: responseData,
      };
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        throw {
          status: 504,
          message: `Request to upstream TRENDS API timed out after ${timeoutMs}ms`,
        };
      }

      // If upstream failed with 401 and mock fallback is enabled in dev, allow fallback
      if (allowMockFallback) {
        console.warn(
          `[TRENDS API Proxy] Upstream request failed (${(err as { message?: string })?.message || "error"}). Falling back to mock dataset for local development.`
        );
        const mockData = this.resolveMockData<T>(region, endpointPath, options);
        if (mockData !== undefined) {
          return {
            status: 200,
            data: mockData,
            isMockFallback: true,
          };
        }
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private static resolveMockData<T>(
    region: Region,
    endpointPath: string,
    options: RequestOptions
  ): T | undefined {
    const cleanPath = endpointPath.replace(/\.json$/, "").replace(/^\//, "");

    if (cleanPath.startsWith("categories")) {
      return MOCK_CATEGORIES as unknown as T;
    }
    if (cleanPath.startsWith("lead-times")) {
      return MOCK_LEAD_TIMES as unknown as T;
    }
    if (cleanPath.startsWith("stock")) {
      const parts = cleanPath.split("/");
      const id = parts[1] || "10042";
      return getMockStock(id, region) as unknown as T;
    }
    if (cleanPath.startsWith("products/")) {
      const id = cleanPath.split("/")[1] || "10042";
      return getMockSingleProduct(id, region) as unknown as T;
    }
    if (cleanPath.startsWith("products")) {
      return getMockProducts(region) as unknown as T;
    }
    if (cleanPath.startsWith("orders")) {
      if (options.method === "POST") {
        const body = (options.body || {}) as Record<string, unknown>;
        return {
          order_number: `SO-${Math.floor(100000 + Math.random() * 900000)}`,
          status: "Received",
          ...body,
          order_date: new Date().toISOString(),
        } as unknown as T;
      }
      return getMockOrders(region) as unknown as T;
    }

    return undefined;
  }
}
