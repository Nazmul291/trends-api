import { create } from "zustand";
import type { Region, RegionalServerConfig } from "../../shared/types/trends.types";
import { REGION_CONFIGS } from "../../shared/types/trends.types";

export type StoreStatus = "idle" | "loading" | "success" | "error";

interface RegionState {
  currentRegion: Region;
  regionConfig: RegionalServerConfig;
  availableRegions: Record<Region, RegionalServerConfig>;
  status: StoreStatus;
  error: string | null;

  // Actions
  setRegion: (region: Region) => void;
  resetRegion: () => void;
}

const DEFAULT_REGION: Region = "nz";

export const useRegionStore = create<RegionState>((set) => ({
  currentRegion: DEFAULT_REGION,
  regionConfig: REGION_CONFIGS[DEFAULT_REGION],
  availableRegions: REGION_CONFIGS,
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
}));
