/**
 * App Settings Service
 *
 * Provides DB-backed storage for Trends API configuration (API key, mock fallback flag,
 * active regions, and background synchronization schedule & parameters).
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
  // Automated Background Sync Configuration
  autoSyncEnabled: boolean;
  syncFrequency: string; // "daily" | "every_12_hours" | "hourly" | "custom"
  syncTime: string; // e.g. "02:00"
  syncBatchSize: number; // 10 - 100 (default: 50)
  syncScope: string[]; // ["inventory", "price"]
  lastSyncedAt: Date | string | null;
  syncStatus: "idle" | "running" | "failed" | string;
  syncErrorMessage: string | null;
  // Inventory Location Strategy
  inventorySyncMode: "single" | "split_equal";
  targetLocationId: string | null;
  splitLocationIds: string[];
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

export function normalizeSyncScope(raw?: string[] | null): string[] {
  if (!Array.isArray(raw)) return ["inventory", "price"];
  const valid = raw.filter((s) => ["inventory", "price"].includes(s));
  return valid.length > 0 ? valid : ["inventory", "price"];
}

export function normalizeSyncBatchSize(size?: number | string | null): number {
  const parsed = typeof size === "number" ? size : parseInt(String(size), 10);
  if (isNaN(parsed)) return 50;
  return Math.min(100, Math.max(10, parsed));
}

export function normalizeInventorySyncMode(mode?: string | null): "single" | "split_equal" {
  if (mode === "split_equal") return "split_equal";
  return "single";
}

// ---------------------------------------------------------------------------
// Environment variable fallback
// ---------------------------------------------------------------------------

function getEnvFallback(): AppSettingsData {
  return {
    trendsApiKey: process.env.TRENDS_API_KEY || null,
    enableTrendsMockFallback: process.env.ENABLE_TRENDS_MOCK_FALLBACK !== "false",
    enabledRegions: ALL_REGIONS,
    autoSyncEnabled: true,
    syncFrequency: "daily",
    syncTime: "02:00",
    syncBatchSize: 50,
    syncScope: ["inventory", "price"],
    lastSyncedAt: null,
    syncStatus: "idle",
    syncErrorMessage: null,
    inventorySyncMode: "single",
    targetLocationId: null,
    splitLocationIds: [],
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
        autoSyncEnabled: record.autoSyncEnabled,
        syncFrequency: record.syncFrequency || "daily",
        syncTime: record.syncTime || "02:00",
        syncBatchSize: normalizeSyncBatchSize(record.syncBatchSize),
        syncScope: normalizeSyncScope(record.syncScope),
        lastSyncedAt: record.lastSyncedAt,
        syncStatus: record.syncStatus || "idle",
        syncErrorMessage: record.syncErrorMessage || null,
        inventorySyncMode: normalizeInventorySyncMode(record.inventorySyncMode),
        targetLocationId: record.targetLocationId || null,
        splitLocationIds: Array.isArray(record.splitLocationIds) ? record.splitLocationIds : [],
      };
      setCache(shop, data);
      return data;
    }
  } catch (err) {
    console.warn("[AppSettings] DB read failed, falling back to env vars:", (err as Error).message);
  }

  // 3. Env variable fallback
  const envData = getEnvFallback();
  setCache(shop, envData);
  return envData;
}

/**
 * Persists settings for a shop to the DB and busts the cache.
 */
export async function saveAppSettings(
  shop: string,
  settings: Partial<AppSettingsData> & Record<string, any>
): Promise<AppSettingsData> {
  // Validate: at least one region must be enabled
  if (settings.enabledRegions !== undefined) {
    const normalized = normalizeRegions(settings.enabledRegions);
    if (normalized.length === 0) {
      throw new Error("At least one region must remain enabled.");
    }
    settings = { ...settings, enabledRegions: normalized };
  }

  const rawMode = settings.inventorySyncMode ?? settings.inventory_sync_mode;
  const rawTargetLoc = settings.targetLocationId ?? settings.target_location_id;
  const rawSplitLocs = settings.splitLocationIds ?? settings.split_location_ids;

  const record = await prisma.appSettings.upsert({
    where: { shop },
    create: {
      shop,
      trendsApiKey: settings.trendsApiKey ?? null,
      enableTrendsMockFallback: settings.enableTrendsMockFallback ?? true,
      enabledRegions: settings.enabledRegions ?? ALL_REGIONS,
      autoSyncEnabled: settings.autoSyncEnabled ?? true,
      syncFrequency: settings.syncFrequency ?? "daily",
      syncTime: settings.syncTime ?? "02:00",
      syncBatchSize: settings.syncBatchSize !== undefined ? normalizeSyncBatchSize(settings.syncBatchSize) : 50,
      syncScope: settings.syncScope !== undefined ? normalizeSyncScope(settings.syncScope) : ["inventory", "price"],
      lastSyncedAt: settings.lastSyncedAt ?? null,
      syncStatus: settings.syncStatus ?? "idle",
      syncErrorMessage: settings.syncErrorMessage ?? null,
      inventorySyncMode: rawMode !== undefined ? normalizeInventorySyncMode(rawMode) : "single",
      targetLocationId: rawTargetLoc !== undefined ? rawTargetLoc : null,
      splitLocationIds: Array.isArray(rawSplitLocs) ? rawSplitLocs : [],
    },
    update: {
      ...(settings.trendsApiKey !== undefined && { trendsApiKey: settings.trendsApiKey }),
      ...(settings.enableTrendsMockFallback !== undefined && {
        enableTrendsMockFallback: settings.enableTrendsMockFallback,
      }),
      ...(settings.enabledRegions !== undefined && { enabledRegions: settings.enabledRegions }),
      ...(settings.autoSyncEnabled !== undefined && { autoSyncEnabled: settings.autoSyncEnabled }),
      ...(settings.syncFrequency !== undefined && { syncFrequency: settings.syncFrequency }),
      ...(settings.syncTime !== undefined && { syncTime: settings.syncTime }),
      ...(settings.syncBatchSize !== undefined && { syncBatchSize: normalizeSyncBatchSize(settings.syncBatchSize) }),
      ...(settings.syncScope !== undefined && { syncScope: normalizeSyncScope(settings.syncScope) }),
      ...(settings.lastSyncedAt !== undefined && { lastSyncedAt: settings.lastSyncedAt }),
      ...(settings.syncStatus !== undefined && { syncStatus: settings.syncStatus }),
      ...(settings.syncErrorMessage !== undefined && { syncErrorMessage: settings.syncErrorMessage }),
      ...(rawMode !== undefined && { inventorySyncMode: normalizeInventorySyncMode(rawMode) }),
      ...(rawTargetLoc !== undefined && { targetLocationId: rawTargetLoc }),
      ...(rawSplitLocs !== undefined && { splitLocationIds: Array.isArray(rawSplitLocs) ? rawSplitLocs : [] }),
    },
  });

  const data: AppSettingsData = {
    trendsApiKey: record.trendsApiKey || null,
    enableTrendsMockFallback: record.enableTrendsMockFallback,
    enabledRegions: normalizeRegions(record.enabledRegions),
    autoSyncEnabled: record.autoSyncEnabled,
    syncFrequency: record.syncFrequency || "daily",
    syncTime: record.syncTime || "02:00",
    syncBatchSize: normalizeSyncBatchSize(record.syncBatchSize),
    syncScope: normalizeSyncScope(record.syncScope),
    lastSyncedAt: record.lastSyncedAt,
    syncStatus: record.syncStatus || "idle",
    syncErrorMessage: record.syncErrorMessage || null,
    inventorySyncMode: normalizeInventorySyncMode(record.inventorySyncMode),
    targetLocationId: record.targetLocationId || null,
    splitLocationIds: Array.isArray(record.splitLocationIds) ? record.splitLocationIds : [],
  };

  // Bust cache so next read is fresh
  invalidateSettingsCache(shop);
  setCache(shop, data);

  return data;
}
