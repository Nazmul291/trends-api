import React from "react";
import type { Region } from "../../../shared/types/trends.types";
import { formatCurrency } from "../../../shared/utils/formatters";
import { useRegionStore } from "../../stores/useRegionStore";

export interface PriceTagProps {
  amount?: number | string | null;
  region?: Region;
  label?: string;
  size?: "sm" | "md" | "lg";
  bold?: boolean;
}

export const PriceTag: React.FC<PriceTagProps> = ({
  amount,
  region,
  label,
  size = "md",
  bold = true,
}) => {
  if (amount === undefined || amount === null || amount === "") {
    return null;
  }

  const num = typeof amount === "string" ? parseFloat(amount.replace(/[^0-9.-]+/g, "")) : Number(amount);
  if (isNaN(num) || num <= 0) {
    return null;
  }

  const currentRegion = useRegionStore((s) => s.currentRegion);
  const activeRegion = region || currentRegion;
  const formatted = formatCurrency(num, activeRegion);

  if (!formatted || formatted === "-" || formatted.trim() === "$" || !/\d/.test(formatted)) {
    return null;
  }

  const fontSizes = {
    sm: "12px",
    md: "15px",
    lg: "20px",
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "baseline", gap: "4px" }}>
      {label && (
        <span style={{ fontSize: "11px", color: "#5c5f62", textTransform: "uppercase" }}>
          {label}
        </span>
      )}
      <span
        style={{
          fontSize: fontSizes[size],
          fontWeight: bold ? 700 : 500,
          color: "#202223",
          letterSpacing: "-0.01em",
        }}
      >
        {formatted}
      </span>
    </div>
  );
};
