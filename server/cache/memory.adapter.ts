import type { CacheAdapter } from "./cache-adapter.interface";

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number | null; // null means persistent
}

/**
 * In-Memory Cache Adapter
 * Lightweight, zero-dependency TTL cache for local development and fallback runtime.
 */
export class MemoryCacheAdapter implements CacheAdapter {
  private store = new Map<string, MemoryCacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async flush(): Promise<void> {
    this.store.clear();
  }
}
