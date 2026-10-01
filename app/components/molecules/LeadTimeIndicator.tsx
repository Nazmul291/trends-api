import React from "react";
import type { LeadTimeData } from "../../../shared/types/trends.types";
import { StatusBadge } from "../atoms/StatusBadge";

export interface LeadTimeIndicatorProps {
  leadTimes: LeadTimeData[];
}

export const LeadTimeIndicator: React.FC<LeadTimeIndicatorProps> = ({ leadTimes }) => {
  if (!leadTimes || leadTimes.length === 0) {
    return <span style={{ fontSize: "12px", color: "#6d7175" }}>Standard lead times apply</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={{ fontSize: "12px", fontWeight: 600, color: "#202223" }}>
        Production Lead Times
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {leadTimes.map((lt, idx) => (
          <div
            key={idx}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 8px",
              backgroundColor: "#f6f6f7",
              borderRadius: "6px",
              border: "1px solid #e1e3e5",
            }}
          >
            <span style={{ fontSize: "12px", color: "#5c5f62" }}>{lt.process}:</span>
            <StatusBadge label={lt.lead_time} tone="info" size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
};
