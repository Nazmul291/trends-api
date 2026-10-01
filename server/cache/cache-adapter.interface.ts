/**
 * Cache Adapter Interface
 * Provides a unified abstraction for caching across local memory/Redis and production Vercel KV / Upstash.
 */

export interface CacheAdapter {
  /**
   * Retrieves an item from the cache.
   * Returns null if missing or expired.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Stores an item in the cache with a specified TTL in seconds.
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Deletes a specific key from the cache.
   */
  del(key: string): Promise<void>;

  /**
   * Clears all cache entries managed by this adapter.
   */
  flush(): Promise<void>;
}

export interface CacheConfig {
  categoriesTtl: number;
  leadTimesTtl: number;
  productsListTtl: number;
  productShowTtl: number;
  stockTtl: number;
  ordersTtl: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  categoriesTtl: 86400, // 24 hours
  leadTimesTtl: 43200,   // 12 hours
  productsListTtl: 3600, // 1 hour
  productShowTtl: 7200,  // 2 hours
  stockTtl: 60,          // 60 seconds (micro-cache for high-frequency hits)
  ordersTtl: 0,          // Strictly bypassed
};
