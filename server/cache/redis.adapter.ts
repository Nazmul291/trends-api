import type { CacheAdapter } from "./cache-adapter.interface";

/**
 * Redis & Vercel KV REST Adapter
 * Compatible with Vercel KV / Upstash Redis HTTP API without requiring heavy TCP sockets in serverless runtimes.
 */
export class RedisRestCacheAdapter implements CacheAdapter {
  private baseUrl: string;
  private token: string;

  constructor(url: string, token: string) {
    this.baseUrl = url.replace(/\/$/, "");
    this.token = token;
  }

  private async executeCommand<T>(command: string, ...args: (string | number)[]): Promise<T | null> {
    try {
      const endpoint = `${this.baseUrl}/${command}/${args.map(encodeURIComponent).join("/")}`;
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const json = await response.json();
      return json.result as T;
    } catch (err) {
      console.warn(`[RedisRestCacheAdapter] Failed executing ${command}:`, err);
      return null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.executeCommand<string>("get", key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.executeCommand("set", key, serialized, "EX", ttlSeconds);
    } else {
      await this.executeCommand("set", key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.executeCommand("del", key);
  }

  async flush(): Promise<void> {
    await this.executeCommand("flushdb");
  }
}
