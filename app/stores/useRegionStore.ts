import { create } from "zustand";
import type { Region, RegionalServerConfig } from "../../shared/types/trends.types";
import { REGION_CONFIGS } from "../../shared/types/trends.types";

export type StoreStatus = "idle" | "loading" | "success" | "error";

interface RegionState {
  currentRegion: Region;
  regionConfig: RegionalServerConfig;
  availableRegions: Record<Region, RegionalServerConfig>;
  /** Regions the admin has enabled in Settings. Drives tab visibility. */
  enabledRegions: Region[];
  /** Whether the store has been populated with server-verified enabled settings */
  isInitialized: boolean;
  status: StoreStatus;
  error: string | null;

  // Actions
  setRegion: (region: Region) => void;
  resetRegion: () => void;
  /**
   * Called by layouts/loaders on mount to initialise the enabled-region
   * list from the server settings. If preferredRegion is specified and enabled,
   * it is selected. Otherwise, if currentRegion is enabled it is kept.
   * If neither is enabled, it automatically switches to the first enabled region.
   */
  setEnabledRegions: (regions: Region[], preferredRegion?: Region) => void;
}

const ALL_REGIONS: Region[] = ["nz", "au", "sg"];
const DEFAULT_FALLBACK_REGION: Region = "au";

export const useRegionStore = create<RegionState>((set, get) => ({
  currentRegion: DEFAULT_FALLBACK_REGION,
  regionConfig: REGION_CONFIGS[DEFAULT_FALLBACK_REGION],
  availableRegions: REGION_CONFIGS,
  enabledRegions: ALL_REGIONS,
  isInitialized: false,
  status: "idle",
  error: null,

  setRegion: (region: Region) => {
    const { enabledRegions } = get();
    if (!REGION_CONFIGS[region]) {
      set({
        status: "error",
        error: `Invalid region: ${region}. Available regions are nz, au, sg.`,
      });
      return;
    }

    if (enabledRegions.length > 0 && !enabledRegions.includes(region)) {
      set({
        status: "error",
        error: `Region ${region} is not enabled in settings.`,
      });
      return;
    }

    set({
      currentRegion: region,
      regionConfig: REGION_CONFIGS[region],
      status: "success",
      error: null,
    });
  },

  resetRegion: () => {
    const { enabledRegions } = get();
    const fallback = enabledRegions.length > 0 ? enabledRegions[0] : DEFAULT_FALLBACK_REGION;
    set({
      currentRegion: fallback,
      regionConfig: REGION_CONFIGS[fallback],
      status: "idle",
      error: null,
    });
  },

  setEnabledRegions: (regions: Region[], preferredRegion?: Region) => {
    const valid = (regions || []).filter((r) => REGION_CONFIGS[r]);
    const effective = valid.length > 0 ? valid : ALL_REGIONS;
    const { currentRegion, isInitialized } = get();

    // Determine the active region:
    // 1. If preferredRegion is specified and valid, use it.
    // 2. If already initialized and currentRegion is enabled, retain it.
    // 3. Otherwise, strictly auto-select the first enabled region from settings.
    let nextRegion: Region;
    if (preferredRegion && effective.includes(preferredRegion)) {
      nextRegion = preferredRegion;
    } else if (isInitialized && effective.includes(currentRegion)) {
      nextRegion = currentRegion;
    } else {
      nextRegion = effective[0];
    }

    set({
      enabledRegions: effective,
      currentRegion: nextRegion,
      regionConfig: REGION_CONFIGS[nextRegion],
      isInitialized: true,
      status: "success",
      error: null,
    });
  },
}));
