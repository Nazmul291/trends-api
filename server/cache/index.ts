import type { CacheAdapter } from "./cache-adapter.interface";
import { MemoryCacheAdapter } from "./memory.adapter";
import { RedisRestCacheAdapter } from "./redis.adapter";
import { IoRedisCacheAdapter } from "./ioredis.adapter";

export * from "./cache-adapter.interface";
export * from "./key-builder";
export * from "./memory.adapter";
export * from "./redis.adapter";
export * from "./ioredis.adapter";

class CacheManager {
  private static instance: CacheAdapter;

  static getAdapter(): CacheAdapter {
    if (this.instance) {
      return this.instance;
    }

    const redisUrl = process.env.REDIS_URL;
    const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (redisUrl) {
      this.instance = new IoRedisCacheAdapter(redisUrl);
    } else if (kvUrl && kvToken) {
      this.instance = new RedisRestCacheAdapter(kvUrl, kvToken);
    } else {
      this.instance = new MemoryCacheAdapter();
    }

    return this.instance;
  }
}

export const cacheAdapter = CacheManager.getAdapter();

