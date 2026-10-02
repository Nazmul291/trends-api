/**
 * App Settings Service
 *
 * Provides DB-backed storage for Trends API configuration (API key, mock fallback flag,
 * and the set of enabled/active regions).
 * Uses a lightweight in-process TTL cache to avoid a DB query on every request.
 * Gracefully falls back to environment variables when no DB record exists, so existing
 * dev environments continue to work during and after migration.
 */

import prisma from "../../app/db.server";
import type { Region } from "../../shared/types/trends.types";
import { ALL_REGIONS } from "../../shared/types/trends.types";

export { ALL_REGIONS };


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppSettingsData {
  trendsApiKey: string | null;
  enableTrendsMockFallback: boolean;
  /** Lower-case region codes that are currently enabled for this shop. */
  enabledRegions: Region[];
}

// ---------------------------------------------------------------------------
// In-memory cache (per-shop, keyed by shop domain)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: AppSettingsData;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute
const settingsCache = new Map<string, CacheEntry>();

function getCached(shop: string): AppSettingsData | null {
  const entry = settingsCache.get(shop);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    settingsCache.delete(shop);
    return null;
  }
  return entry.data;
}

function setCache(shop: string, data: AppSettingsData): void {
  settingsCache.set(shop, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateSettingsCache(shop: string): void {
  settingsCache.delete(shop);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates and coerces the stored region list from the DB.
 * Ensures at least one valid region is always returned.
 */
function normalizeRegions(raw: string[]): Region[] {
  const valid = raw.filter((r): r is Region => ALL_REGIONS.includes(r as Region));
  return valid.length > 0 ? valid : ALL_REGIONS;
}

// ---------------------------------------------------------------------------
// Environment variable fallback
// ---------------------------------------------------------------------------

function getEnvFallback(): AppSettingsData {
  return {
    trendsApiKey: process.env.TRENDS_API_KEY || null,
    enableTrendsMockFallback: process.env.ENABLE_TRENDS_MOCK_FALLBACK !== "false",
    enabledRegions: ALL_REGIONS,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads settings for a shop from the DB (with cache).
 * Falls back to environment variables when no DB record exists.
 */
export async function getAppSettings(shop: string): Promise<AppSettingsData> {
  // 1. In-memory cache hit
  const cached = getCached(shop);
  if (cached) return cached;

  // 2. DB lookup
  try {
    const record = await prisma.appSettings.findUnique({ where: { shop } });
    if (record) {
      const data: AppSettingsData = {
        trendsApiKey: record.trendsApiKey || null,
        enableTrendsMockFallback: record.enableTrendsMockFallback,
        enabledRegions: normalizeRegions(record.enabledRegions),
      };
      setCache(shop, data);
      return data;
    }
  } catch (err) {
    console.warn("[AppSettings] DB read failed, falling back to env vars:", (err as Error).message);
  }

  // 3. Env variable fallback
  const envData = getEnvFallback();
  // Cache the fallback briefly too, to prevent hammering the DB during startup
  setCache(shop, envData);
  return envData;
}

/**
 * Persists settings for a shop to the DB and busts the cache.
 */
export async function saveAppSettings(
  shop: string,
  settings: Partial<AppSettingsData>
): Promise<AppSettingsData> {
  // Validate: at least one region must be enabled
  if (settings.enabledRegions !== undefined) {
    const normalized = normalizeRegions(settings.enabledRegions);
    if (normalized.length === 0) {
      throw new Error("At least one region must remain enabled.");
    }
    settings = { ...settings, enabledRegions: normalized };
  }

  const record = await prisma.appSettings.upsert({
    where: { shop },
    create: {
      shop,
      trendsApiKey: settings.trendsApiKey ?? null,
      enableTrendsMockFallback: settings.enableTrendsMockFallback ?? true,
      enabledRegions: settings.enabledRegions ?? ALL_REGIONS,
    },
    update: {
      ...(settings.trendsApiKey !== undefined && { trendsApiKey: settings.trendsApiKey }),
      ...(settings.enableTrendsMockFallback !== undefined && {
        enableTrendsMockFallback: settings.enableTrendsMockFallback,
      }),
      ...(settings.enabledRegions !== undefined && { enabledRegions: settings.enabledRegions }),
    },
  });

  const data: AppSettingsData = {
    trendsApiKey: record.trendsApiKey || null,
    enableTrendsMockFallback: record.enableTrendsMockFallback,
    enabledRegions: normalizeRegions(record.enabledRegions),
  };

  // Bust cache so next read is fresh
  invalidateSettingsCache(shop);
  // Pre-populate with the fresh data
  setCache(shop, data);

  return data;
}
