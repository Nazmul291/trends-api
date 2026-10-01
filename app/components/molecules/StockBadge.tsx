import React from "react";
import { StatusBadge } from "../atoms/StatusBadge";
import { evaluateStockStatus, formatDate } from "../../../shared/utils/formatters";

export interface StockBadgeProps {
  quantity: number;
  nextShipment?: number;
  dueDate?: string | null;
  size?: "sm" | "md";
}

export const StockBadge: React.FC<StockBadgeProps> = ({
  quantity,
  nextShipment,
  dueDate,
  size = "md",
}) => {
  const status = evaluateStockStatus(quantity);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: "2px" }}>
      <StatusBadge label={status.label} tone={status.tone} size={size} dot />
      {nextShipment && nextShipment > 0 && dueDate && (
        <span style={{ fontSize: "10px", color: "#6d7175", marginLeft: "4px" }}>
          +{nextShipment} arriving {formatDate(dueDate)}
        </span>
      )}
    </div>
  );
};
