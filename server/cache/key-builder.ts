import type { Region } from "../../shared/types/trends.types";

/**
 * Deterministic Cache Key Builder
 * Taxonomy: trends:{region}:{resource}:{queryHash_or_id}
 */
export class CacheKeyBuilder {
  private static serializeParams(params?: Record<string, unknown> | URLSearchParams): string {
    if (!params) return "default";

    const entries: [string, string][] = [];

    if (params instanceof URLSearchParams) {
      params.forEach((value, key) => {
        entries.push([key, value]);
      });
    } else {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          entries.push([key, String(value)]);
        }
      }
    }

    if (entries.length === 0) return "default";

    // Sort keys alphabetically for canonical caching
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }

  static categories(region: Region, incDiscontinued: boolean = false): string {
    return `trends:${region}:categories:inc_discontinued=${incDiscontinued}`;
  }

  static leadTimes(region: Region): string {
    return `trends:${region}:lead_times:all`;
  }

  static productsList(region: Region, params?: Record<string, unknown> | URLSearchParams): string {
    const serialized = this.serializeParams(params);
    return `trends:${region}:products:list:${serialized}`;
  }

  static productShow(region: Region, productId: string | number): string {
    return `trends:${region}:product:${productId}`;
  }

  static stock(region: Region, productId: string | number): string {
    return `trends:${region}:stock:${productId}`;
  }

  static custom(region: Region, resource: string, identifier?: string): string {
    return `trends:${region}:${resource}:${identifier || "default"}`;
  }
}
