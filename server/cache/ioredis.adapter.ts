import { Redis } from "ioredis";
import type { CacheAdapter } from "./cache-adapter.interface";

/**
 * Standard Redis Adapter (TCP-based)
 * Used in containerized environments (Docker, Fly.io, Railway, Kubernetes) via REDIS_URL.
 */
export class IoRedisCacheAdapter implements CacheAdapter {
  private client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    this.client.on("error", (err) => {
      console.warn("[IoRedisCacheAdapter] Redis connection error:", err.message);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;

      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    } catch (err) {
      console.warn(`[IoRedisCacheAdapter] Failed to get key "${key}":`, err);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, serialized, "EX", ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (err) {
      console.warn(`[IoRedisCacheAdapter] Failed to set key "${key}":`, err);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      console.warn(`[IoRedisCacheAdapter] Failed to del key "${key}":`, err);
    }
  }

  async flush(): Promise<void> {
    try {
      await this.client.flushdb();
    } catch (err) {
      console.warn("[IoRedisCacheAdapter] Failed to flushdb:", err);
    }
  }
}
