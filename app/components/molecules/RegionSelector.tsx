import React from "react";
import type { Region } from "../../../shared/types/trends.types";
import { useRegionStore } from "../../stores/useRegionStore";
import { useCatalogStore } from "../../stores/useCatalogStore";

const REGION_METADATA: Record<Region, { flag: string; label: string; currency: string }> = {
  nz: { flag: "🇳🇿", label: "New Zealand", currency: "NZD" },
  au: { flag: "🇦🇺", label: "Australia", currency: "AUD" },
  sg: { flag: "🇸🇬", label: "Singapore", currency: "SGD" },
};

export const RegionSelector: React.FC = () => {
  const currentRegion = useRegionStore((s) => s.currentRegion);
  const setRegion = useRegionStore((s) => s.setRegion);
  const fetchCategories = useCatalogStore((s) => s.fetchCategories);
  const fetchProducts = useCatalogStore((s) => s.fetchProducts);

  const handleRegionChange = (newRegion: Region) => {
    if (newRegion !== currentRegion) {
      setRegion(newRegion);
      // Automatically refresh catalog for the newly active region
      fetchCategories();
      fetchProducts({ pageNo: 1 });
    }
  };

  const regions: Region[] = ["nz", "au", "sg"];

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
      {regions.map((reg) => {
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
