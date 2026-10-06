import React, { useState, useEffect, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAppSettings,
  saveAppSettings,
  normalizeSyncBatchSize,
} from "../../server/settings/app-settings.service";
import {
  scheduleShopSync,
  triggerManualSync,
  getSchedulerStatus,
} from "../../server/services/sync-scheduler.server";
import {
  processSyncChunk,
  resetSyncCursor,
} from "../../server/services/chunk-sync.service";
import { buildCronExpression } from "../../shared/utils/cron";
import type { Region } from "../../shared/types/trends.types";
import { ALL_REGIONS } from "../../shared/types/trends.types";

// ---------------------------------------------------------------------------
// Region display metadata
// ---------------------------------------------------------------------------

const REGION_META: Record<Region, { flag: string; label: string; currency: string }> = {
  nz: { flag: "🇳🇿", label: "New Zealand", currency: "NZD" },
  au: { flag: "🇦🇺", label: "Australia", currency: "AUD" },
  sg: { flag: "🇸🇬", label: "Singapore", currency: "SGD" },
};

// ---------------------------------------------------------------------------
// Client-side: "Sync All" per-product orchestration
// ---------------------------------------------------------------------------

interface SyncTriggerResponse {
  success: boolean;
  error?: string;
  mode?: "background" | "client_chunk";
  jobId?: string;
  totalVariants?: number;
  chunkSize?: number;
  productToSync?: unknown;
  syncLocks?: string[];
  isMock?: boolean;
  inventorySyncMode?: "single" | "split_equal";
  targetLocationId?: string | null;
  splitLocationIds?: string[];
}

interface SyncChunkResponse {
  success: boolean;
  error?: string;
  status?: string;
  hasMore?: boolean;
  nextOffset?: number | null;
}

/**
 * Drives a single product's sync to completion, transparently handling either
 * outcome of POST sync-product: QStash background dispatch (poll sync-status)
 * or, if QStash is unavailable, the client-driven chunk fallback (loop
 * sync-chunk). Used by the Settings page "Sync All" loop below, one product at
 * a time, so the browser — not a single long-lived serverless invocation —
 * coordinates the whole catalog resync.
 */
async function syncOneProductToCompletion(
  trendsCode: string,
  region: Region
): Promise<{ success: boolean; error?: string }> {
  let triggerData: SyncTriggerResponse;
  try {
    const res = await fetch(`/api/proxy/${region}/sync-product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: trendsCode, region }),
    });
    triggerData = await res.json();
    if (!res.ok || !triggerData.success) {
      return { success: false, error: triggerData.error || `Sync initiation failed (HTTP ${res.status})` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to initiate sync" };
  }

  const jobId = triggerData.jobId;
  if (!jobId) {
    return { success: false, error: "Sync initiation did not return a jobId" };
  }

  if (triggerData.mode === "client_chunk") {
    const chunkSize = triggerData.chunkSize || 10;
    const productToSync = triggerData.productToSync;
    let offset = 0;
    // The initial `totalVariants` estimate can be stale (the sync pipeline
    // re-fetches live stock on every call), so loop continuation is driven by
    // each chunk response's own `hasMore`, never by a fixed count. This cap is
    // only a safety net against an unexpected server-side loop.
    const MAX_CHUNK_ITERATIONS = 500;

    for (let iteration = 0; iteration < MAX_CHUNK_ITERATIONS; iteration++) {
      let chunkData: SyncChunkResponse | null = null;
      let lastErr: string | null = null;

      for (let attempt = 0; attempt <= 2 && !chunkData; attempt++) {
        try {
          const res = await fetch(`/api/proxy/${region}/sync-chunk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              trendsCode,
              productToSync,
              offset,
              limit: chunkSize,
              syncLocks: triggerData.syncLocks,
              isMock: triggerData.isMock,
              inventorySyncMode: triggerData.inventorySyncMode,
              targetLocationId: triggerData.targetLocationId,
              splitLocationIds: triggerData.splitLocationIds,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || `Chunk sync failed (HTTP ${res.status})`);
          }
          chunkData = data;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : "Chunk sync request failed";
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }

      if (!chunkData) {
        return { success: false, error: lastErr || "Chunk sync failed after retries" };
      }
      if (chunkData.status === "COMPLETED" || !chunkData.hasMore) {
        return { success: true };
      }
      offset = chunkData.nextOffset ?? offset + chunkSize;
    }
    return { success: false, error: "Chunk sync did not complete after an unexpectedly large number of chunks" };
  }

  // mode === "background": poll sync-status until COMPLETED/FAILED, same 2-minute
  // ceiling used by the product-detail page's polling loop.
  const pollStart = Date.now();
  while (Date.now() - pollStart < 120_000) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(
        `/api/proxy/${region}/sync-status?jobId=${encodeURIComponent(jobId)}&productId=${encodeURIComponent(trendsCode)}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status === "COMPLETED") return { success: true };
      if (data.status === "FAILED") {
        return { success: false, error: data.errorMessage || data.message || "Sync failed" };
      }
    } catch {
      // transient poll error — keep retrying until the timeout above
    }
  }
  return { success: false, error: "Sync timed out after 2 minutes" };
}

// ---------------------------------------------------------------------------
// Server-side: Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getAppSettings(shop);

  // Fetch live Shopify store locations
  let locations: Array<{ id: string; name: string; isPrimary: boolean }> = [];
  try {
    const locRes = await admin.graphql(
      `#graphql
      query getLocations {
        locations(first: 20, includeInactive: false) {
          nodes {
            id
            name
            isPrimary
          }
        }
      }`
    );
    const locJson = await locRes.json();
    locations = locJson?.data?.locations?.nodes || [];
  } catch (err) {
    console.warn("[Settings] Failed to fetch Shopify locations:", err);
  }

  // Ensure background scheduler is initialized if auto-sync is enabled
  let schedulerStatus = getSchedulerStatus(shop);
  if (!schedulerStatus.isScheduled && settings.autoSyncEnabled) {
    scheduleShopSync(shop, settings);
    schedulerStatus = getSchedulerStatus(shop);
  }

  const primaryLocId = locations.find((l) => l.isPrimary)?.id || locations[0]?.id || "";

  return {
    shop,
    trendsApiKey: settings.trendsApiKey ?? "",
    enableTrendsMockFallback: settings.enableTrendsMockFallback,
    enabledRegions: settings.enabledRegions,
    autoSyncEnabled: settings.autoSyncEnabled,
    syncFrequency: settings.syncFrequency,
    syncTime: settings.syncTime,
    syncBatchSize: settings.syncBatchSize,
    syncScope: settings.syncScope,
    inventorySyncMode: settings.inventorySyncMode || "single",
    targetLocationId: settings.targetLocationId || primaryLocId,
    splitLocationIds:
      settings.splitLocationIds && settings.splitLocationIds.length > 0
        ? settings.splitLocationIds
        : locations.length >= 2
        ? locations.slice(0, 2).map((l) => l.id)
        : [],
    locations,
    lastSyncedAt: settings.lastSyncedAt ? new Date(settings.lastSyncedAt).toISOString() : null,
    syncStatus: settings.syncStatus,
    syncErrorMessage: settings.syncErrorMessage,
    isScheduled: schedulerStatus.isScheduled,
    cronExpression: schedulerStatus.cronExpression,
    currentSyncPage: settings.currentSyncPage ?? 1,
    totalCatalogPages: settings.totalCatalogPages ?? 1,
    syncCursorStatus: settings.syncCursorStatus ?? "idle",
    lastChunkProcessedAt: settings.lastChunkProcessedAt
      ? new Date(settings.lastChunkProcessedAt).toISOString()
      : null,
  };
};

// ---------------------------------------------------------------------------
// Server-side: Action (form submission)
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("actionType");

  // 1a. Run Single Sync Chunk Immediately (Safe Vercel Serverless Batch)
  if (actionType === "runSyncChunk") {
    try {
      const result = await processSyncChunk(shop, { isManual: true });
      return {
        success: result.success,
        actionType: "runSyncChunk",
        message: result.message,
        error: result.error || null,
        chunkResult: result,
      };
    } catch (err) {
      return {
        success: false,
        actionType: "runSyncChunk",
        message: null,
        error: err instanceof Error ? err.message : "Sync chunk execution failed.",
      };
    }
  }

  // 1b. Reset Sync Cursor to Page 1
  if (actionType === "resetSyncCursor") {
    try {
      await resetSyncCursor(shop);
      return {
        success: true,
        actionType: "resetSyncCursor",
        message: "Sync cursor successfully reset to Page 1.",
      };
    } catch (err) {
      return {
        success: false,
        actionType: "resetSyncCursor",
        message: null,
        error: err instanceof Error ? err.message : "Failed to reset cursor.",
      };
    }
  }

  // 1c. Manual Full Sync Trigger
  if (actionType === "syncNow") {
    try {
      const result = await triggerManualSync(shop);
      return {
        success: result.success,
        actionType: "syncNow",
        message: result.message,
        error: result.error || null,
      };
    } catch (err) {
      return {
        success: false,
        actionType: "syncNow",
        message: null,
        error: err instanceof Error ? err.message : "Manual sync failed to start.",
      };
    }
  }

  // 2. Standard Settings Update
  const rawKey = formData.get("trendsApiKey");
  const mockFallbackVal = formData.get("enableTrendsMockFallback");

  // Collect enabled regions from form checkboxes
  const enabledRegions = ALL_REGIONS.filter((r) => formData.get(`region_${r}`) === "on");

  const trendsApiKey = typeof rawKey === "string" ? rawKey.trim() || null : null;
  const enableTrendsMockFallback = mockFallbackVal === "true";

  // Validate at least one region
  if (enabledRegions.length === 0) {
    return {
      success: false,
      actionType: "saveSettings",
      error: "At least one region must remain enabled.",
    };
  }

  // Background Sync preferences
  const autoSyncEnabled = formData.get("autoSyncEnabled") === "true";
  const syncFrequency = String(formData.get("syncFrequency") || "daily");
  const syncTime = String(formData.get("syncTime") || "02:00");
  const rawBatchSize = formData.get("syncBatchSize");
  const syncBatchSize = normalizeSyncBatchSize(rawBatchSize ? Number(rawBatchSize) : 50);

  const syncScope: string[] = [];
  if (formData.get("syncScope_inventory") === "on") syncScope.push("inventory");
  if (formData.get("syncScope_price") === "on") syncScope.push("price");
  if (syncScope.length === 0) syncScope.push("inventory");

  // Inventory Location Strategy
  const rawMode = formData.get("inventorySyncMode");
  const inventorySyncMode = rawMode === "split_equal" ? "split_equal" : "single";
  const targetLocationId = formData.get("targetLocationId")
    ? String(formData.get("targetLocationId")).trim()
    : null;
  const splitLocationIds = formData
    .getAll("splitLocationIds")
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean);

  // Form validation per requirement:
  // "Prevent saving if Single Mode has no location selected, or if Split Mode has fewer than 2 locations checked."
  if (inventorySyncMode === "single" && !targetLocationId) {
    return {
      success: false,
      actionType: "saveSettings",
      error: "Please select a target Shopify location for Single Location mode.",
    };
  }

  if (inventorySyncMode === "split_equal" && splitLocationIds.length < 2) {
    return {
      success: false,
      actionType: "saveSettings",
      error: "Please select at least 2 Shopify locations to use Equal Split mode.",
    };
  }

  try {
    const saved = await saveAppSettings(shop, {
      trendsApiKey,
      enableTrendsMockFallback,
      enabledRegions,
      autoSyncEnabled,
      syncFrequency,
      syncTime,
      syncBatchSize,
      syncScope,
      inventorySyncMode,
      targetLocationId,
      splitLocationIds,
    });

    // Dynamically reschedule background runner
    const schedResult = scheduleShopSync(shop, saved);

    return {
      success: true,
      actionType: "saveSettings",
      error: null,
      cronExpression: schedResult.cronExpression,
      isScheduled: schedResult.scheduled,
    };
  } catch (err) {
    return {
      success: false,
      actionType: "saveSettings",
      error: err instanceof Error ? err.message : "Failed to save settings.",
    };
  }
};

// ---------------------------------------------------------------------------
// UI Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const {
    trendsApiKey,
    enableTrendsMockFallback,
    enabledRegions,
    autoSyncEnabled: initialAutoSync,
    syncFrequency: initialFrequency,
    syncTime: initialSyncTime,
    syncBatchSize: initialBatchSize,
    syncScope: initialSyncScope,
    inventorySyncMode: initialInventoryMode,
    targetLocationId: initialTargetLocation,
    splitLocationIds: initialSplitLocations,
    locations = [],
    lastSyncedAt,
    syncStatus,
    syncErrorMessage,
    cronExpression,
    currentSyncPage,
    totalCatalogPages,
    syncCursorStatus,
    lastChunkProcessedAt,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Controlled form state
  const [apiKey, setApiKey] = useState(trendsApiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [mockFallback, setMockFallback] = useState(enableTrendsMockFallback);
  const [activeRegions, setActiveRegions] = useState<Region[]>(enabledRegions as Region[]);

  // Background sync controls state
  const [autoSync, setAutoSync] = useState(initialAutoSync);
  const [frequency, setFrequency] = useState(initialFrequency || "daily");
  const [syncTime, setSyncTime] = useState(initialSyncTime || "02:00");
  const [batchSize, setBatchSize] = useState(initialBatchSize || 50);
  const [scopeInventory, setScopeInventory] = useState(initialSyncScope.includes("inventory"));
  const [scopePrice, setScopePrice] = useState(initialSyncScope.includes("price"));

  // Inventory distribution state
  const [inventoryMode, setInventoryMode] = useState<"single" | "split_equal">(
    initialInventoryMode || "single"
  );
  const [targetLocation, setTargetLocation] = useState<string>(initialTargetLocation || "");
  const [splitLocations, setSplitLocations] = useState<string[]>(initialSplitLocations || []);

  // Browser-driven "Sync All" state. Separate from the automated cron chunker
  // above: this walks the full catalog one product at a time from the browser,
  // so progress and per-product failures are visible live instead of only via
  // the cron's page-sized batch summary.
  const [syncAllState, setSyncAllState] = useState<{
    status: "idle" | "running" | "completed" | "error";
    totalProducts: number;
    currentIndex: number;
    currentCode: string | null;
    failedProducts: Array<{ code: string; error: string }>;
  }>({
    status: "idle",
    totalProducts: 0,
    currentIndex: 0,
    currentCode: null,
    failedProducts: [],
  });

  const syncAllRegion: Region = ((enabledRegions as Region[])[0] || "au") as Region;

  const runSyncAll = async () => {
    setSyncAllState({
      status: "running",
      totalProducts: 0,
      currentIndex: 0,
      currentCode: null,
      failedProducts: [],
    });

    let productIds: string[] = [];
    try {
      const initRes = await fetch(`/api/proxy/${syncAllRegion}/sync-all-init`);
      const initData = await initRes.json();
      if (!initRes.ok || !initData.success) {
        throw new Error(initData.error || "Failed to load product catalog");
      }
      productIds = initData.productIds || [];
    } catch (err) {
      setSyncAllState((prev) => ({
        ...prev,
        status: "error",
        failedProducts: [
          { code: "catalog", error: err instanceof Error ? err.message : "Failed to load catalog" },
        ],
      }));
      return;
    }

    setSyncAllState((prev) => ({ ...prev, totalProducts: productIds.length }));

    const failed: Array<{ code: string; error: string }> = [];
    for (let i = 0; i < productIds.length; i++) {
      const code = productIds[i];
      setSyncAllState((prev) => ({ ...prev, currentIndex: i + 1, currentCode: code }));

      const result = await syncOneProductToCompletion(code, syncAllRegion);
      if (!result.success) {
        failed.push({ code, error: result.error || "Unknown error" });
        setSyncAllState((prev) => ({ ...prev, failedProducts: [...failed] }));
      }
    }

    setSyncAllState((prev) => ({ ...prev, status: "completed", currentCode: null, failedProducts: failed }));
  };

  // Persisted state baseline for tracking unsaved modifications
  const [persistedState, setPersistedState] = useState(() => ({
    apiKey: trendsApiKey ?? "",
    mockFallback: enableTrendsMockFallback,
    activeRegions: [...(enabledRegions as Region[])].sort(),
    autoSync: initialAutoSync,
    frequency: initialFrequency || "daily",
    syncTime: initialSyncTime || "02:00",
    batchSize: initialBatchSize || 50,
    scopeInventory: initialSyncScope.includes("inventory"),
    scopePrice: initialSyncScope.includes("price"),
    inventoryMode: initialInventoryMode || "single",
    targetLocation: initialTargetLocation || "",
    splitLocations: [...(initialSplitLocations || [])].sort(),
  }));

  // Re-synchronize baseline whenever fresh loader data is loaded
  useEffect(() => {
    setPersistedState({
      apiKey: trendsApiKey ?? "",
      mockFallback: enableTrendsMockFallback,
      activeRegions: [...(enabledRegions as Region[])].sort(),
      autoSync: initialAutoSync,
      frequency: initialFrequency || "daily",
      syncTime: initialSyncTime || "02:00",
      batchSize: initialBatchSize || 50,
      scopeInventory: initialSyncScope.includes("inventory"),
      scopePrice: initialSyncScope.includes("price"),
      inventoryMode: initialInventoryMode || "single",
      targetLocation: initialTargetLocation || "",
      splitLocations: [...(initialSplitLocations || [])].sort(),
    });
  }, [
    trendsApiKey,
    enableTrendsMockFallback,
    enabledRegions,
    initialAutoSync,
    initialFrequency,
    initialSyncTime,
    initialBatchSize,
    initialSyncScope,
    initialInventoryMode,
    initialTargetLocation,
    initialSplitLocations,
  ]);

  const hasSaved = actionData?.success === true && actionData?.actionType === "saveSettings";
  const hasSaveError = actionData?.success === false && actionData?.actionType === "saveSettings";
  const hasSyncNowSuccess = actionData?.success === true && actionData?.actionType === "syncNow";
  const hasSyncNowError = actionData?.success === false && actionData?.actionType === "syncNow";
  const hasChunkSuccess = actionData?.success === true && actionData?.actionType === "runSyncChunk";
  const hasChunkError = actionData?.success === false && actionData?.actionType === "runSyncChunk";
  const hasResetSuccess = actionData?.success === true && actionData?.actionType === "resetSyncCursor";
  const hasResetError = actionData?.success === false && actionData?.actionType === "resetSyncCursor";

  // Re-synchronize baseline immediately upon successful save action
  useEffect(() => {
    if (hasSaved) {
      setPersistedState({
        apiKey,
        mockFallback,
        activeRegions: [...activeRegions].sort(),
        autoSync,
        frequency,
        syncTime,
        batchSize,
        scopeInventory,
        scopePrice,
        inventoryMode,
        targetLocation,
        splitLocations: [...splitLocations].sort(),
      });
    }
  }, [hasSaved]);

  // Robust deep dirty-state checking across all form fields
  const isDirty = useMemo(() => {
    if (apiKey !== persistedState.apiKey) return true;
    if (mockFallback !== persistedState.mockFallback) return true;
    if (autoSync !== persistedState.autoSync) return true;
    if (frequency !== persistedState.frequency) return true;
    if (syncTime !== persistedState.syncTime) return true;
    if (batchSize !== persistedState.batchSize) return true;
    if (scopeInventory !== persistedState.scopeInventory) return true;
    if (scopePrice !== persistedState.scopePrice) return true;
    if (inventoryMode !== persistedState.inventoryMode) return true;
    if (targetLocation !== persistedState.targetLocation) return true;

    // Compare active regions list
    const currentSorted = [...activeRegions].sort();
    if (currentSorted.length !== persistedState.activeRegions.length) return true;
    for (let i = 0; i < currentSorted.length; i++) {
      if (currentSorted[i] !== persistedState.activeRegions[i]) return true;
    }

    // Compare split locations list
    const currentSplitSorted = [...splitLocations].sort();
    if (currentSplitSorted.length !== persistedState.splitLocations.length) return true;
    for (let i = 0; i < currentSplitSorted.length; i++) {
      if (currentSplitSorted[i] !== persistedState.splitLocations[i]) return true;
    }

    return false;
  }, [
    apiKey,
    mockFallback,
    activeRegions,
    autoSync,
    frequency,
    syncTime,
    batchSize,
    scopeInventory,
    scopePrice,
    inventoryMode,
    targetLocation,
    splitLocations,
    persistedState,
  ]);

  // Discard changes & restore initial persisted state
  const handleDiscard = () => {
    setApiKey(persistedState.apiKey);
    setMockFallback(persistedState.mockFallback);
    setActiveRegions([...persistedState.activeRegions]);
    setAutoSync(persistedState.autoSync);
    setFrequency(persistedState.frequency);
    setSyncTime(persistedState.syncTime);
    setBatchSize(persistedState.batchSize);
    setScopeInventory(persistedState.scopeInventory);
    setScopePrice(persistedState.scopePrice);
    setInventoryMode(persistedState.inventoryMode);
    setTargetLocation(persistedState.targetLocation);
    setSplitLocations([...persistedState.splitLocations]);
  };

  const toggleRegion = (region: Region) => {
    setActiveRegions((prev) => {
      const isActive = prev.includes(region);
      if (isActive && prev.length === 1) return prev;
      return isActive ? prev.filter((r) => r !== region) : [...prev, region];
    });
  };

  const toggleSplitLocation = (locId: string) => {
    setSplitLocations((prev) => {
      if (prev.includes(locId)) {
        return prev.filter((id) => id !== locId);
      } else {
        return [...prev, locId];
      }
    });
  };

  // Preview generated cron expression
  const previewCron = buildCronExpression(frequency, syncTime);

  // Validation: Single mode must have a target location; Split mode must have >= 2 locations
  const isLocationValid =
    inventoryMode === "single"
      ? Boolean(targetLocation && targetLocation.trim().length > 0)
      : splitLocations.length >= 2;

  const isSaveDisabled = !isDirty || isSubmitting || !isLocationValid;

  // Format last synced timestamp
  const formattedLastSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "Never";

  return (
    <div
      style={{
        maxWidth: "760px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      {/* Page Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          backgroundColor: "#ffffff",
          padding: "20px 24px",
          borderRadius: "12px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <span style={{ fontSize: "28px" }}>⚙️</span>
        <div>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#202223" }}>
            Trends API & Background Sync Settings
          </h1>
          <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#6d7175" }}>
            Manage your Trends API credentials, active regions, and automated background sync schedules.
          </p>
        </div>
      </div>

      {/* Notifications / Toast Banners */}
      {hasSaved && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#f3fdf7",
            border: "1px solid #1a9e6c",
            borderRadius: "10px",
            color: "#1a5c3e",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>✅</span>
          Settings and background scheduler updated successfully. Schedule is now active.
        </div>
      )}

      {hasSaveError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#fff4f4",
            border: "1px solid #d82c0d",
            borderRadius: "10px",
            color: "#7c1c0a",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>❌</span>
          {actionData?.error || "An error occurred while saving."}
        </div>
      )}

      {hasSyncNowSuccess && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#f0f8ff",
            border: "1px solid #5c8ff7",
            borderRadius: "10px",
            color: "#1d4ed8",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>🚀</span>
          {actionData?.message || "Manual background sync completed successfully."}
        </div>
      )}

      {hasSyncNowError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#fff4f4",
            border: "1px solid #d82c0d",
            borderRadius: "10px",
            color: "#7c1c0a",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>❌</span>
          {actionData?.error || "Manual background sync failed."}
        </div>
      )}

      {hasChunkSuccess && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #16a34a",
            borderRadius: "10px",
            color: "#166534",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>⚡</span>
          {actionData?.message || "Sync chunk processed successfully."}
        </div>
      )}

      {hasChunkError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#fff4f4",
            border: "1px solid #d82c0d",
            borderRadius: "10px",
            color: "#7c1c0a",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>❌</span>
          {actionData?.error || "Sync chunk execution failed."}
        </div>
      )}

      {hasResetSuccess && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#eff6ff",
            border: "1px solid #3b82f6",
            borderRadius: "10px",
            color: "#1e40af",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>🔄</span>
          {actionData?.message || "Sync cursor reset to Page 1."}
        </div>
      )}

      {hasResetError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#fff4f4",
            border: "1px solid #d82c0d",
            borderRadius: "10px",
            color: "#7c1c0a",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>❌</span>
          {actionData?.error || "Failed to reset cursor."}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* SECTION 1: Automated Background Sync Card                        */}
      {/* ----------------------------------------------------------------- */}
      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #e1e3e5",
          borderRadius: "12px",
          padding: "24px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div>
            <h2
              style={{
                margin: "0 0 6px 0",
                fontSize: "16px",
                fontWeight: 700,
                color: "#202223",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>⏱️</span> Automated Background Sync
            </h2>
            <p style={{ margin: 0, fontSize: "13px", color: "#6d7175" }}>
              Automatically synchronizes Shopify product inventory and pricing on a recurring schedule.
            </p>
          </div>

          {/* Sync Now Trigger Form */}
          <Form method="post">
            <input type="hidden" name="actionType" value="syncNow" />
            <button
              type="submit"
              disabled={isSubmitting || syncStatus === "running"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: syncStatus === "running" ? "#6d7175" : "#008060",
                backgroundColor: syncStatus === "running" ? "#f1f2f3" : "#e6f4ea",
                border: "1px solid #a3d9c9",
                borderRadius: "8px",
                cursor: syncStatus === "running" ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (syncStatus !== "running") e.currentTarget.style.backgroundColor = "#c9eddf";
              }}
              onMouseLeave={(e) => {
                if (syncStatus !== "running") e.currentTarget.style.backgroundColor = "#e6f4ea";
              }}
            >
              <span>{syncStatus === "running" ? "⏳" : "⚡"}</span>
              {syncStatus === "running" ? "Syncing in Progress…" : "Sync Now"}
            </button>
          </Form>
        </div>

        {/* Live Runner Status & Last Run Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            padding: "12px 16px",
            backgroundColor: "#f9fafb",
            borderRadius: "8px",
            border: "1px solid #e1e3e5",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "#6d7175", fontWeight: 600 }}>Runner Status:</span>
            {syncStatus === "running" ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#1d4ed8",
                  backgroundColor: "#eff6ff",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  border: "1px solid #bfdbfe",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: "#3b82f6",
                    display: "inline-block",
                  }}
                />
                Syncing in Progress
              </span>
            ) : syncStatus === "failed" ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#b91c1c",
                  backgroundColor: "#fef2f2",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  border: "1px solid #fecaca",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: "#ef4444",
                    display: "inline-block",
                  }}
                />
                Failed
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: autoSync ? "#15803d" : "#6d7175",
                  backgroundColor: autoSync ? "#f0fdf4" : "#f3f4f6",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  border: `1px solid ${autoSync ? "#bbf7d0" : "#e5e7eb"}`,
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: autoSync ? "#22c55e" : "#9ca3af",
                    display: "inline-block",
                  }}
                />
                {autoSync ? "Idle (Ready)" : "Paused"}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "12px", color: "#6d7175" }}>
            <span>
              Last Run: <strong style={{ color: "#202223" }}>{formattedLastSync}</strong>
            </span>
            <span>
              Schedule:{" "}
              <code
                style={{
                  fontFamily: "monospace",
                  backgroundColor: "#f1f2f3",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  color: "#202223",
                }}
              >
                {autoSync ? cronExpression || previewCron : "disabled"}
              </code>
            </span>
          </div>
        </div>

        {/* Sync Error Banner if runner previously failed */}
        {syncStatus === "failed" && syncErrorMessage && (
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "#fef2f2",
              border: "1px solid #f87171",
              borderRadius: "8px",
              color: "#991b1b",
              fontSize: "12px",
              marginBottom: "20px",
            }}
          >
            <strong>Last Error:</strong> {syncErrorMessage}
          </div>
        )}

        {/* Stateful Vercel Cron Chunk Cursor Panel */}
        <div
          style={{
            backgroundColor: "#f8fafc",
            border: "1px solid #cbd5e1",
            borderRadius: "10px",
            padding: "16px 20px",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              marginBottom: "12px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
                  Serverless Chunk Sync Cursor
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    backgroundColor:
                      syncCursorStatus === "completed"
                        ? "#dcfce7"
                        : syncCursorStatus === "in_progress"
                        ? "#e0e7ff"
                        : "#f1f5f9",
                    color:
                      syncCursorStatus === "completed"
                        ? "#15803d"
                        : syncCursorStatus === "in_progress"
                        ? "#4338ca"
                        : "#475569",
                    border: `1px solid ${
                      syncCursorStatus === "completed"
                        ? "#86efac"
                        : syncCursorStatus === "in_progress"
                        ? "#c7d2fe"
                        : "#cbd5e1"
                    }`,
                  }}
                >
                  {syncCursorStatus === "completed"
                    ? "Cycle Completed"
                    : syncCursorStatus === "in_progress"
                    ? "In Progress"
                    : "Idle"}
                </span>
              </div>
              <p style={{ margin: "3px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                Vercel Cron processes a safe 12-item slice per invocation to eliminate serverless timeouts.
              </p>
            </div>

            {/* Manual Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Form method="post">
                <input type="hidden" name="actionType" value="runSyncChunk" />
                <button
                  type="submit"
                  disabled={isSubmitting || syncStatus === "running"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#0f766e",
                    backgroundColor: "#ccfbf1",
                    border: "1px solid #99f6e4",
                    borderRadius: "6px",
                    cursor: isSubmitting || syncStatus === "running" ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease",
                  }}
                  title="Execute a single safe 12-item batch immediately and advance cursor"
                >
                  <span>⚡</span> Run Chunk Now
                </button>
              </Form>

              <Form method="post">
                <input type="hidden" name="actionType" value="resetSyncCursor" />
                <button
                  type="submit"
                  disabled={isSubmitting || syncStatus === "running"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    backgroundColor: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    cursor: isSubmitting || syncStatus === "running" ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease",
                  }}
                  title="Reset cursor pagination back to page 1"
                >
                  <span>🔄</span> Reset Cursor
                </button>
              </Form>
            </div>
          </div>

          {/* Progress Bar & Details */}
          <div style={{ marginTop: "10px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "12px",
                color: "#334155",
                marginBottom: "6px",
              }}
            >
              <span>
                Catalog Cursor: <strong>Page {currentSyncPage}</strong> of{" "}
                <strong>{totalCatalogPages || 1}</strong>
              </span>
              <span>
                Last Chunk Processed:{" "}
                <strong>
                  {lastChunkProcessedAt
                    ? new Date(lastChunkProcessedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }) +
                      " on " +
                      new Date(lastChunkProcessedAt).toLocaleDateString()
                    : "Not yet run"}
                </strong>
              </span>
            </div>

            {/* Visual Bar */}
            <div
              style={{
                width: "100%",
                height: "6px",
                backgroundColor: "#e2e8f0",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(
                    100,
                    Math.max(
                      2,
                      Math.round(
                        ((currentSyncPage) / (totalCatalogPages || 1)) * 100
                      )
                    )
                  )}%`,
                  backgroundColor:
                    syncCursorStatus === "completed" ? "#10b981" : "#3b82f6",
                  borderRadius: "3px",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "11px",
                color: "#94a3b8",
                marginTop: "4px",
              }}
            >
              <span>Endpoint: <code>/api/cron/sync-chunk</code></span>
              <span>Cron Schedule: <code>0 2 * * *</code> (Daily on Hobby / Pro or External for frequent)</span>
            </div>
          </div>
        </div>

        {/* Main Settings Form */}
        <Form method="post" noValidate>
          <input type="hidden" name="actionType" value="saveSettings" />

          {/* Master Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px",
              backgroundColor: autoSync ? "#f3fdf7" : "#f9fafb",
              borderRadius: "8px",
              border: `1px solid ${autoSync ? "#c2e5d9" : "#e1e3e5"}`,
              marginBottom: "20px",
              transition: "all 0.15s ease",
            }}
          >
            <input type="hidden" name="autoSyncEnabled" value={autoSync ? "true" : "false"} />
            <div>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                Enable Automatic Background Sync
              </p>
              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                When enabled, background cron runner executes automated catalog sync according to the schedule below.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSync}
              onClick={() => setAutoSync((v) => !v)}
              style={{
                position: "relative",
                width: "48px",
                height: "26px",
                borderRadius: "13px",
                border: "none",
                cursor: "pointer",
                transition: "background-color 0.2s ease",
                backgroundColor: autoSync ? "#008060" : "#babfc3",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "3px",
                  left: autoSync ? "25px" : "3px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "#ffffff",
                  transition: "left 0.2s ease",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </button>
          </div>

          {/* Schedule Controls */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
              marginBottom: "20px",
              opacity: autoSync ? 1 : 0.6,
              transition: "opacity 0.2s ease",
            }}
          >
            {/* Frequency Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label
                htmlFor="syncFrequency"
                style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}
              >
                Sync Frequency
              </label>
              <select
                id="syncFrequency"
                name="syncFrequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                disabled={!autoSync}
                style={{
                  padding: "9px 12px",
                  fontSize: "13px",
                  color: "#202223",
                  backgroundColor: "#fafbfb",
                  border: "1px solid #babfc3",
                  borderRadius: "8px",
                  outline: "none",
                  cursor: autoSync ? "pointer" : "not-allowed",
                  boxSizing: "border-box",
                }}
              >
                <option value="daily">Daily (Once per day)</option>
                <option value="every_12_hours">Every 12 Hours (Twice per day)</option>
                <option value="hourly">Hourly (Every 60 minutes)</option>
              </select>
              <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#6d7175" }}>
                {frequency === "daily"
                  ? "Runs once every 24 hours at the configured preferred time."
                  : frequency === "every_12_hours"
                  ? "Runs twice every 24 hours (12 hours apart)."
                  : "Runs continuously at the start of every hour."}
              </p>
            </div>

            {/* Run Time Picker */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label
                htmlFor="syncTime"
                style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}
              >
                Preferred Run Time (24h)
              </label>
              <input
                id="syncTime"
                name="syncTime"
                type="time"
                value={syncTime}
                onChange={(e) => setSyncTime(e.target.value)}
                disabled={!autoSync || frequency === "hourly"}
                style={{
                  padding: "8px 12px",
                  fontSize: "13px",
                  color: "#202223",
                  backgroundColor: !autoSync || frequency === "hourly" ? "#f1f2f3" : "#fafbfb",
                  border: "1px solid #babfc3",
                  borderRadius: "8px",
                  outline: "none",
                  cursor: !autoSync || frequency === "hourly" ? "not-allowed" : "pointer",
                  boxSizing: "border-box",
                }}
              />
              <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#6d7175" }}>
                {frequency === "hourly"
                  ? "Fixed at minute 0 of each hour."
                  : "Recommended: 02:00 AM off-peak hours to minimize load."}
              </p>
            </div>
          </div>

          {/* Batching & Performance */}
          <div
            style={{
              padding: "16px",
              backgroundColor: "#f9fafb",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <label
                htmlFor="syncBatchSize"
                style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}
              >
                Products Per Batch
              </label>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#008060",
                  backgroundColor: "#e6f4ea",
                  padding: "2px 8px",
                  borderRadius: "6px",
                }}
              >
                {batchSize} items
              </span>
            </div>

            <input
              id="syncBatchSize"
              name="syncBatchSize"
              type="range"
              min="10"
              max="100"
              step="5"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: "#008060",
                cursor: "pointer",
                marginBottom: "6px",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#8c9196" }}>
              <span>10 (Minimum)</span>
              <span>50 (Recommended Default)</span>
              <span>100 (Maximum)</span>
            </div>
            <p style={{ margin: "6px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
              Products are synchronized in staggered throttled requests to prevent Shopify GraphQL throttling.
            </p>
          </div>

          {/* Sync Scope Selection */}
          <div style={{ marginBottom: "24px" }}>
            <p style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: 600, color: "#202223" }}>
              Sync Scope (Select Attributes to Sync)
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* Scope 1: Inventory */}
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "12px 14px",
                  backgroundColor: scopeInventory ? "#f3fdf7" : "#fafbfb",
                  border: `1px solid ${scopeInventory ? "#c2e5d9" : "#e1e3e5"}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="checkbox"
                  name="syncScope_inventory"
                  checked={scopeInventory}
                  onChange={(e) => setScopeInventory(e.target.checked)}
                  style={{ accentColor: "#008060", marginTop: "2px", width: "16px", height: "16px" }}
                />
                <div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}>
                    Sync Stock / Inventory Quantities
                  </span>
                  <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                    Queries live Trends warehouse stock and updates available inventory quantities for all Shopify variants.
                  </p>
                </div>
              </label>

              {/* Scope 2: Price */}
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "12px 14px",
                  backgroundColor: scopePrice ? "#f3fdf7" : "#fafbfb",
                  border: `1px solid ${scopePrice ? "#c2e5d9" : "#e1e3e5"}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="checkbox"
                  name="syncScope_price"
                  checked={scopePrice}
                  onChange={(e) => setScopePrice(e.target.checked)}
                  style={{ accentColor: "#008060", marginTop: "2px", width: "16px", height: "16px" }}
                />
                <div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}>
                    Sync Variant Prices
                  </span>
                  <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                    Retrieves updated wholesale pricing breaks from Trends and updates corresponding variant prices on Shopify.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* ----------------------------------------------------------------- */}
          {/* SECTION: Inventory Location Strategy                              */}
          {/* ----------------------------------------------------------------- */}
          <section
            style={{
              borderTop: "1px solid #e1e3e5",
              paddingTop: "24px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "16px",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: "0 0 6px 0",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#202223",
                  }}
                >
                  Inventory Location Strategy
                </h2>
                <p style={{ margin: 0, fontSize: "13px", color: "#6d7175" }}>
                  Configure how Trends API warehouse inventory stock is routed across your Shopify locations during synchronization.
                </p>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  padding: "3px 8px",
                  borderRadius: "12px",
                  backgroundColor: inventoryMode === "single" ? "#e0f2fe" : "#f0fdf4",
                  color: inventoryMode === "single" ? "#0369a1" : "#15803d",
                  border: `1px solid ${inventoryMode === "single" ? "#bae6fd" : "#bbf7d0"}`,
                }}
              >
                {inventoryMode === "single"
                  ? "Single Location"
                  : `Equal Split (${splitLocations.length} locations)`}
              </span>
            </div>

            {/* Mode Selection Cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              {/* Option 1: Single Location */}
              <div
                onClick={() => setInventoryMode("single")}
                style={{
                  padding: "14px 16px",
                  borderRadius: "8px",
                  border: `2px solid ${inventoryMode === "single" ? "#008060" : "#e1e3e5"}`,
                  backgroundColor: inventoryMode === "single" ? "#f3fdf7" : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                }}
              >
                <input
                  type="radio"
                  name="inventory_mode_choice"
                  checked={inventoryMode === "single"}
                  onChange={() => setInventoryMode("single")}
                  style={{ marginTop: "3px", accentColor: "#008060" }}
                />
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                    Single Location Mode
                  </div>
                  <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6d7175", lineHeight: "1.4" }}>
                    100% of variant stock quantity is assigned directly to one selected Shopify location.
                  </p>
                </div>
              </div>

              {/* Option 2: Split Equally */}
              <div
                onClick={() => setInventoryMode("split_equal")}
                style={{
                  padding: "14px 16px",
                  borderRadius: "8px",
                  border: `2px solid ${inventoryMode === "split_equal" ? "#008060" : "#e1e3e5"}`,
                  backgroundColor: inventoryMode === "split_equal" ? "#f3fdf7" : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                }}
              >
                <input
                  type="radio"
                  name="inventory_mode_choice"
                  checked={inventoryMode === "split_equal"}
                  onChange={() => setInventoryMode("split_equal")}
                  style={{ marginTop: "3px", accentColor: "#008060" }}
                />
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                    Split Equally Across Locations
                  </div>
                  <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6d7175", lineHeight: "1.4" }}>
                    Total stock is divided equally among chosen locations with zero unit loss (remainder allocated first).
                  </p>
                </div>
              </div>
            </div>

            {/* Mode 1 Configuration: Single Location Dropdown */}
            {inventoryMode === "single" && (
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#f9fafb",
                  borderRadius: "8px",
                  border: "1px solid #e1e3e5",
                }}
              >
                <label
                  htmlFor="targetLocationSelect"
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#202223",
                    marginBottom: "8px",
                  }}
                >
                  Target Shopify Location
                </label>
                {locations.length > 0 ? (
                  <select
                    id="targetLocationSelect"
                    value={targetLocation}
                    onChange={(e) => setTargetLocation(e.target.value)}
                    style={{
                      width: "100%",
                      maxWidth: "400px",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      fontSize: "14px",
                      backgroundColor: "#ffffff",
                      outline: "none",
                      color: "#202223",
                    }}
                  >
                    <option value="" disabled>
                      -- Select Target Location --
                    </option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} {loc.isPrimary ? "(Primary Fulfillment Location)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "#fffbeb",
                      border: "1px solid #fef3c7",
                      borderRadius: "6px",
                      color: "#b45309",
                      fontSize: "12px",
                    }}
                  >
                    No active Shopify locations discovered. Please check your Shopify Admin location settings.
                  </div>
                )}
                <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                  All incoming stock updates from Trends will be assigned to this location exclusively.
                </p>
              </div>
            )}

            {/* Mode 2 Configuration: Split Equally Multi-Select Checkboxes */}
            {inventoryMode === "split_equal" && (
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#f9fafb",
                  borderRadius: "8px",
                  border: "1px solid #e1e3e5",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div>
                    <label style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}>
                      Select Active Locations for Equal Split
                    </label>
                    <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                      Check at least 2 locations that should participate in equal stock distribution.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => setSplitLocations(locations.map((l) => l.id))}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#008060",
                        backgroundColor: "#ffffff",
                        border: "1px solid #c9cccf",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitLocations([])}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#6d7175",
                        backgroundColor: "#ffffff",
                        border: "1px solid #c9cccf",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                {/* Validation message if < 2 locations */}
                {splitLocations.length < 2 && (
                  <div
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "#fffbeb",
                      border: "1px solid #fef3c7",
                      borderRadius: "6px",
                      color: "#b45309",
                      fontSize: "12px",
                      fontWeight: 600,
                      marginBottom: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>⚠️</span>
                    <span>
                      Please select at least 2 locations to enable Equal Split mode (currently{" "}
                      {splitLocations.length} selected).
                    </span>
                  </div>
                )}

                {/* Location Checkboxes List */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: "10px",
                    marginBottom: "16px",
                  }}
                >
                  {locations.map((loc) => {
                    const isChecked = splitLocations.includes(loc.id);
                    return (
                      <label
                        key={loc.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 14px",
                          backgroundColor: isChecked ? "#f0fdf4" : "#ffffff",
                          border: `1px solid ${isChecked ? "#86efac" : "#e1e3e5"}`,
                          borderRadius: "6px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSplitLocation(loc.id)}
                          style={{ accentColor: "#008060", width: "16px", height: "16px" }}
                        />
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}>
                            {loc.name}
                          </span>
                          {loc.isPrimary && (
                            <span
                              style={{
                                marginLeft: "6px",
                                fontSize: "10px",
                                fontWeight: 700,
                                color: "#008060",
                                backgroundColor: "#e6f4ea",
                                padding: "1px 5px",
                                borderRadius: "4px",
                              }}
                            >
                              PRIMARY
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Live Math Calculation Preview Card */}
                {splitLocations.length >= 2 && (
                  <div
                    style={{
                      padding: "12px 14px",
                      backgroundColor: "#f4f6f8",
                      borderRadius: "6px",
                      border: "1px solid #d2d5d8",
                      fontSize: "12px",
                      color: "#4a4d50",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#202223", marginBottom: "4px" }}>
                      📊 Mathematical Distribution Preview (Example with 10 units):
                    </div>
                    <div>
                      {(() => {
                        const count = splitLocations.length;
                        const baseQty = Math.floor(10 / count);
                        const remainder = 10 % count;
                        const selectedLocNames = splitLocations
                          .map((id) => locations.find((l) => l.id === id)?.name || id)
                          .map(
                            (name, i) => `${name}: ${i < remainder ? baseQty + 1 : baseQty} units`
                          );
                        return (
                          <span>
                            Formula: <code>Math.floor(10 / {count}) = {baseQty}</code> with{" "}
                            <code>10 % {count} = {remainder}</code> remainder.
                            <br />
                            <strong>Allocation:</strong> {selectedLocNames.join(" · ")} (Total: 10 units
                            preserved, zero units lost).
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Hidden fields for form submission */}
            <input type="hidden" name="inventorySyncMode" value={inventoryMode} />
            <input type="hidden" name="targetLocationId" value={targetLocation} />
            {splitLocations.map((id) => (
              <input key={id} type="hidden" name="splitLocationIds" value={id} />
            ))}
          </section>

          {/* ----------------------------------------------------------------- */}
          {/* SECTION 2: API Credentials Card                                  */}
          {/* ----------------------------------------------------------------- */}
          <section
            style={{
              borderTop: "1px solid #e1e3e5",
              paddingTop: "24px",
              marginBottom: "24px",
            }}
          >
            <h2
              style={{
                margin: "0 0 6px 0",
                fontSize: "15px",
                fontWeight: 700,
                color: "#202223",
              }}
            >
              API Credentials
            </h2>
            <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#6d7175" }}>
              The master Trends API key is used when no region-specific key is set. Region-specific
              environment variables take priority.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "4px" }}>
              <label
                htmlFor="trendsApiKey"
                style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}
              >
                Trends API Key
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  id="trendsApiKey"
                  name="trendsApiKey"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your Trends API Bearer token…"
                  autoComplete="new-password"
                  style={{
                    width: "100%",
                    padding: "9px 44px 9px 12px",
                    fontSize: "13px",
                    color: "#202223",
                    backgroundColor: "#fafbfb",
                    border: "1px solid #babfc3",
                    borderRadius: "8px",
                    outline: "none",
                    fontFamily: showKey ? "monospace" : "inherit",
                    letterSpacing: showKey ? "0" : "0.1em",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  aria-label={showKey ? "Hide API key" : "Reveal API key"}
                  onClick={() => setShowKey((v) => !v)}
                  style={{
                    position: "absolute",
                    right: "10px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#6d7175",
                    fontSize: "16px",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {showKey ? "🙈" : "👁️"}
                </button>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                Stored securely in the database — never logged or exposed to client-side bundles.
              </p>
            </div>
          </section>

          {/* ----------------------------------------------------------------- */}
          {/* SECTION 3: Active Regions Card                                   */}
          {/* ----------------------------------------------------------------- */}
          <section
            style={{
              borderTop: "1px solid #e1e3e5",
              paddingTop: "24px",
              marginBottom: "24px",
            }}
          >
            <h2
              style={{
                margin: "0 0 6px 0",
                fontSize: "15px",
                fontWeight: 700,
                color: "#202223",
              }}
            >
              Active Regions
            </h2>
            <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#6d7175" }}>
              Enable or disable regional TRENDS catalogues. At least one region must remain enabled.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {ALL_REGIONS.map((region) => {
                const meta = REGION_META[region];
                const isActive = activeRegions.includes(region);
                const isLastActive = isActive && activeRegions.length === 1;

                return (
                  <div
                    key={region}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px 16px",
                      backgroundColor: isActive ? "#f3fdf7" : "#f9fafb",
                      borderRadius: "8px",
                      border: `1px solid ${isActive ? "#c2e5d9" : "#e1e3e5"}`,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <input
                      type="checkbox"
                      name={`region_${region}`}
                      id={`region-toggle-${region}`}
                      checked={isActive}
                      onChange={() => toggleRegion(region)}
                      style={{ display: "none" }}
                      readOnly
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "22px" }}>{meta.flag}</span>
                      <div>
                        <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                          {meta.label}
                          <span
                            style={{
                              marginLeft: "8px",
                              fontSize: "11px",
                              fontWeight: 700,
                              color: "#6d7175",
                              backgroundColor: "#f1f2f3",
                              padding: "1px 6px",
                              borderRadius: "4px",
                            }}
                          >
                            {region.toUpperCase()} · {meta.currency}
                          </span>
                        </p>
                        {isLastActive && (
                          <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#d82c0d" }}>
                            ⚠️ Cannot disable — at least one region must remain active.
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      aria-label={`Toggle ${meta.label}`}
                      disabled={isLastActive}
                      onClick={() => toggleRegion(region)}
                      style={{
                        position: "relative",
                        width: "48px",
                        height: "26px",
                        borderRadius: "13px",
                        border: "none",
                        cursor: isLastActive ? "not-allowed" : "pointer",
                        transition: "background-color 0.2s ease",
                        backgroundColor: isActive ? "#008060" : "#babfc3",
                        flexShrink: 0,
                        opacity: isLastActive ? 0.6 : 1,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: "3px",
                          left: isActive ? "25px" : "3px",
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          backgroundColor: "#ffffff",
                          transition: "left 0.2s ease",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ----------------------------------------------------------------- */}
          {/* SECTION 4: Fallback Behaviour Card                               */}
          {/* ----------------------------------------------------------------- */}
          <section
            style={{
              borderTop: "1px solid #e1e3e5",
              paddingTop: "24px",
              marginBottom: "24px",
            }}
          >
            <h2
              style={{
                margin: "0 0 6px 0",
                fontSize: "15px",
                fontWeight: 700,
                color: "#202223",
              }}
            >
              Fallback Behaviour
            </h2>
            <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#6d7175" }}>
              When enabled and API credentials are absent in development, the app returns mock data instead of erroring.
            </p>

            <input type="hidden" name="enableTrendsMockFallback" value={mockFallback ? "true" : "false"} />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px",
                backgroundColor: "#f9fafb",
                borderRadius: "8px",
                border: "1px solid #e1e3e5",
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                  Enable Mock Fallback
                </p>
                <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                  Serves realistic mock catalogue data when credentials are missing.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mockFallback}
                id="enableTrendsMockFallback-toggle"
                onClick={() => setMockFallback((v) => !v)}
                style={{
                  position: "relative",
                  width: "48px",
                  height: "26px",
                  borderRadius: "13px",
                  border: "none",
                  cursor: "pointer",
                  transition: "background-color 0.2s ease",
                  backgroundColor: mockFallback ? "#008060" : "#babfc3",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "3px",
                    left: mockFallback ? "25px" : "3px",
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    backgroundColor: "#ffffff",
                    transition: "left 0.2s ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                />
              </button>
            </div>
          </section>

          {/* Save & Discard Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "12px",
              marginTop: "8px",
            }}
          >
            {/* Unsaved changes badge indicator */}
            {isDirty && (
              <span
                style={{
                  fontSize: "12px",
                  color: "#b45309",
                  backgroundColor: "#fef3c7",
                  border: "1px solid #fde68a",
                  padding: "4px 10px",
                  borderRadius: "12px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: "#f59e0b",
                    display: "inline-block",
                  }}
                />
                Unsaved changes
              </span>
            )}

            {/* Location validation warning badge */}
            {isDirty && !isLocationValid && (
              <span
                style={{
                  fontSize: "12px",
                  color: "#b91c1c",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  padding: "4px 10px",
                  borderRadius: "12px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>⚠️</span>
                {inventoryMode === "single"
                  ? "Select a location for Single Mode"
                  : "Select at least 2 locations for Split Mode"}
              </span>
            )}

            {/* Discard Changes Button */}
            {isDirty && (
              <button
                type="button"
                onClick={handleDiscard}
                disabled={isSubmitting}
                style={{
                  padding: "10px 18px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#5c5f62",
                  backgroundColor: "#ffffff",
                  border: "1px solid #c9cccf",
                  borderRadius: "8px",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSubmitting) e.currentTarget.style.backgroundColor = "#f6f6f7";
                }}
                onMouseLeave={(e) => {
                  if (!isSubmitting) e.currentTarget.style.backgroundColor = "#ffffff";
                }}
              >
                Discard Changes
              </button>
            )}

            {/* Save Button (Disabled by default until dirty or during submission) */}
            <button
              type="submit"
              disabled={isSaveDisabled}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "11px 26px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#ffffff",
                backgroundColor: isSaveDisabled ? "#8c9196" : "#008060",
                border: "none",
                borderRadius: "8px",
                cursor: isSaveDisabled ? "not-allowed" : "pointer",
                opacity: isSaveDisabled ? (isSubmitting ? 0.85 : 0.5) : 1,
                transition: "all 0.15s ease",
                boxShadow: isSaveDisabled ? "none" : "0 1px 2px rgba(0,0,0,0.08)",
              }}
              onMouseEnter={(e) => {
                if (!isSaveDisabled) e.currentTarget.style.backgroundColor = "#006e52";
              }}
              onMouseLeave={(e) => {
                if (!isSaveDisabled) e.currentTarget.style.backgroundColor = "#008060";
              }}
            >
              {isSubmitting ? (
                <>
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      border: "2px solid #ffffff",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "trends-spin 0.6s linear infinite",
                      display: "inline-block",
                    }}
                  />
                  Saving & Rescheduling…
                </>
              ) : (
                <>💾 Save Settings & Schedule</>
              )}
            </button>
          </div>
        </Form>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* SECTION 5: Browser-Driven "Sync All" Card                         */}
      {/* ----------------------------------------------------------------- */}
      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #e1e3e5",
          borderRadius: "12px",
          padding: "24px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div>
            <h2
              style={{
                margin: "0 0 6px 0",
                fontSize: "16px",
                fontWeight: 700,
                color: "#202223",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>🔁</span> Sync All Products Now
            </h2>
            <p style={{ margin: 0, fontSize: "13px", color: "#6d7175" }}>
              Walks the full catalog one product at a time directly from your browser — tries the
              background queue first, and falls back automatically per-product if it&apos;s unavailable.
            </p>
          </div>

          <button
            type="button"
            onClick={runSyncAll}
            disabled={syncAllState.status === "running"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              color: syncAllState.status === "running" ? "#6d7175" : "#008060",
              backgroundColor: syncAllState.status === "running" ? "#f1f2f3" : "#e6f4ea",
              border: "1px solid #a3d9c9",
              borderRadius: "8px",
              cursor: syncAllState.status === "running" ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <span>{syncAllState.status === "running" ? "⏳" : "🔁"}</span>
            {syncAllState.status === "running" ? "Syncing All…" : "Sync All"}
          </button>
        </div>

        {syncAllState.status !== "idle" && (
          <div
            style={{
              padding: "14px 16px",
              backgroundColor: "#f9fafb",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "12px",
                color: "#334155",
                marginBottom: "6px",
              }}
            >
              <span>
                {syncAllState.status === "running" && syncAllState.currentCode
                  ? `Syncing Product ${syncAllState.currentIndex} of ${syncAllState.totalProducts}: ${syncAllState.currentCode}`
                  : syncAllState.status === "completed"
                  ? `Finished: ${syncAllState.totalProducts - syncAllState.failedProducts.length} of ${
                      syncAllState.totalProducts
                    } synced successfully`
                  : syncAllState.status === "error"
                  ? "Failed to start Sync All"
                  : "Preparing…"}
              </span>
              {syncAllState.totalProducts > 0 && (
                <span>
                  {Math.round((syncAllState.currentIndex / syncAllState.totalProducts) * 100)}%
                </span>
              )}
            </div>

            <div
              style={{
                width: "100%",
                height: "6px",
                backgroundColor: "#e2e8f0",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${
                    syncAllState.totalProducts > 0
                      ? Math.min(100, Math.round((syncAllState.currentIndex / syncAllState.totalProducts) * 100))
                      : syncAllState.status === "running"
                      ? 5
                      : 0
                  }%`,
                  backgroundColor:
                    syncAllState.status === "completed"
                      ? syncAllState.failedProducts.length > 0
                        ? "#f59e0b"
                        : "#10b981"
                      : syncAllState.status === "error"
                      ? "#ef4444"
                      : "#3b82f6",
                  borderRadius: "3px",
                  transition: "width 0.3s ease",
                }}
              />
            </div>

            {syncAllState.failedProducts.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <p style={{ margin: "0 0 6px 0", fontSize: "12px", fontWeight: 700, color: "#b45309" }}>
                  Failed Products ({syncAllState.failedProducts.length}):
                </p>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#78350f" }}>
                  {syncAllState.failedProducts.map((f) => (
                    <li key={f.code}>
                      <strong>{f.code}</strong>: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {syncAllState.status === "completed" && (
              <div
                style={{
                  marginTop: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: syncAllState.failedProducts.length > 0 ? "#b45309" : "#047857",
                }}
              >
                <span>{syncAllState.failedProducts.length > 0 ? "⚠️" : "✅"}</span>
                {syncAllState.failedProducts.length > 0
                  ? `Sync All completed with ${syncAllState.failedProducts.length} failure(s). See list above.`
                  : "Sync All completed successfully — every product synced."}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Info Card */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          padding: "16px 18px",
          backgroundColor: "#f6f6f7",
          borderRadius: "10px",
          border: "1px solid #e1e3e5",
        }}
      >
        <span style={{ fontSize: "18px", flexShrink: 0 }}>ℹ️</span>
        <div style={{ fontSize: "12px", color: "#6d7175", lineHeight: 1.6 }}>
          <strong style={{ color: "#202223" }}>Dynamic Scheduler Note:</strong>{" "}
          Changes to sync frequency or time immediately reschedule the active background cron runner in-memory.
          No server reboot is necessary. If auto-sync is switched off, the background runner is paused gracefully.
        </div>
      </div>
    </div>
  );
}
