import React, { useEffect } from "react";
import { useSearchParams } from "react-router";
import type { Region } from "../../../shared/types/trends.types";
import { useRegionStore } from "../../stores/useRegionStore";

const REGION_METADATA: Record<Region, { flag: string; label: string; currency: string }> = {
  nz: { flag: "🇳🇿", label: "New Zealand", currency: "NZD" },
  au: { flag: "🇦🇺", label: "Australia", currency: "AUD" },
  sg: { flag: "🇸🇬", label: "Singapore", currency: "SGD" },
};

export interface RegionSelectorProps {
  /**
   * The subset of regions that are enabled in Settings.
   * Passed from the server loader via app.tsx so we never have to do a
   * client-side fetch just for this. When there is only one entry the
   * component is hidden by the parent — but we still call setEnabledRegions
   * so the store auto-switches if needed.
   */
  enabledRegions: Region[];
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({ enabledRegions }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentRegion = useRegionStore((s) => s.currentRegion);
  const setRegion = useRegionStore((s) => s.setRegion);
  const setEnabledRegions = useRegionStore((s) => s.setEnabledRegions);

  // Sync server-side enabled list into the store on mount / when it changes.
  useEffect(() => {
    setEnabledRegions(enabledRegions);
  }, [enabledRegions, setEnabledRegions]);

  const handleRegionChange = (newRegion: Region) => {
    if (newRegion !== currentRegion) {
      setRegion(newRegion);
      // Synchronize URL query parameter with active selection
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("region", newRegion);
      setSearchParams(nextParams, { replace: true });
    }
  };

  // Render the tab strip — parent (app.tsx) already handles the single-region
  // case by not mounting this component at all, but guard here too.
  if (enabledRegions.length <= 1) return null;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        backgroundColor: "#f1f2f3",
        borderRadius: "10px",
        padding: "3px",
        gap: "4px",
      }}
    >
      {enabledRegions.map((reg) => {
        const active = reg === currentRegion;
        const meta = REGION_METADATA[reg];
        return (
          <button
            key={reg}
            type="button"
            onClick={() => handleRegionChange(reg)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: active ? "#ffffff" : "transparent",
              color: active ? "#202223" : "#6d7175",
              fontWeight: active ? 700 : 500,
              fontSize: "13px",
              cursor: "pointer",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            <span>{meta.flag}</span>
            <span>{reg.toUpperCase()}</span>
            <span
              style={{
                fontSize: "10px",
                color: active ? "#008060" : "#8c9196",
                fontWeight: 600,
              }}
            >
              ({meta.currency})
            </span>
          </button>
        );
      })}
    </div>
  );
};
