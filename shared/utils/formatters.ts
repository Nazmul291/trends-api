import type { Region } from "../types/trends.types";
import { REGION_CONFIGS } from "../types/trends.types";

/**
 * Headless formatting utilities for multi-region currency, numbers, and dates.
 * Ensures zero duplicate formatting logic across UI components.
 */

export function formatCurrency(
  amount: number | string | undefined | null,
  region: Region = "nz",
  customCurrency?: string
): string {
  if (amount === undefined || amount === null || amount === "") {
    return "-";
  }

  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "-";

  const currency = customCurrency || REGION_CONFIGS[region]?.currency || "NZD";

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}

export function formatDate(dateString?: string | null): string {
  if (!dateString) return "-";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return dateString;
  }
}

export type StockLevel = "in_stock" | "low_stock" | "out_of_stock" | "available";

export interface StockStatusInfo {
  level: StockLevel;
  label: string;
  tone: "success" | "warning" | "critical" | "info";
}

export function evaluateStockStatus(
  quantity?: number | null,
  options?: {
    isUntracked?: boolean;
    pricingType?: string;
  }
): StockStatusInfo {
  if (options?.isUntracked || options?.pricingType?.toLowerCase() === "indent") {
    return {
      level: "available",
      label: "Made to Order",
      tone: "info",
    };
  }

  if (quantity === undefined || quantity === null) {
    return {
      level: "available",
      label: "Check Availability",
      tone: "info",
    };
  }

  const num = typeof quantity === "number" ? quantity : Number(quantity) || 0;

  if (num <= 0) {
    return {
      level: "out_of_stock",
      label: "Out of Stock",
      tone: "critical",
    };
  }

  if (num < 100) {
    return {
      level: "low_stock",
      label: `Low Stock (${num})`,
      tone: "warning",
    };
  }

  return {
    level: "in_stock",
    label: `In Stock (${num.toLocaleString()})`,
    tone: "success",
  };
}
