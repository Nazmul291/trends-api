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
  status: StoreStatus;
  error: string | null;

  // Actions
  setRegion: (region: Region) => void;
  resetRegion: () => void;
  /**
   * Called once by the layout on mount to initialise the enabled-region
   * list from the server loader value.  If the current region is no longer
   * enabled it is automatically switched to the first enabled region.
   */
  setEnabledRegions: (regions: Region[]) => void;
}

const DEFAULT_REGION: Region = "nz";
const ALL_REGIONS: Region[] = ["nz", "au", "sg"];

export const useRegionStore = create<RegionState>((set, get) => ({
  currentRegion: DEFAULT_REGION,
  regionConfig: REGION_CONFIGS[DEFAULT_REGION],
  availableRegions: REGION_CONFIGS,
  enabledRegions: ALL_REGIONS,
  status: "idle",
  error: null,

  setRegion: (region: Region) => {
    if (REGION_CONFIGS[region]) {
      set({
        currentRegion: region,
        regionConfig: REGION_CONFIGS[region],
        status: "success",
        error: null,
      });
    } else {
      set({
        status: "error",
        error: `Invalid region: ${region}. Available regions are nz, au, sg.`,
      });
    }
  },

  resetRegion: () => {
    set({
      currentRegion: DEFAULT_REGION,
      regionConfig: REGION_CONFIGS[DEFAULT_REGION],
      status: "idle",
      error: null,
    });
  },

  setEnabledRegions: (regions: Region[]) => {
    const valid = regions.filter((r) => REGION_CONFIGS[r]);
    const effective = valid.length > 0 ? valid : ALL_REGIONS;
    const { currentRegion } = get();

    // If the current region was just disabled, switch to the first enabled one.
    const nextRegion = effective.includes(currentRegion) ? currentRegion : effective[0];

    set({
      enabledRegions: effective,
      currentRegion: nextRegion,
      regionConfig: REGION_CONFIGS[nextRegion],
    });
  },
}));
