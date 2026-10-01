import React from "react";
import { RegionSelector } from "../molecules/RegionSelector";

export interface AppShellProps {
  children: React.ReactNode;
  activeTab?: "catalog" | "orders";
  onTabChange?: (tab: "catalog" | "orders") => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  activeTab = "catalog",
  onTabChange,
}) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        backgroundColor: "#f6f6f7",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <header
        style={{
          backgroundColor: "#ffffff",
          borderBottom: "1px solid #e1e3e5",
          padding: "12px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "20px" }}>⚡</span>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "#202223", letterSpacing: "-0.01em" }}>
              TRENDS API
            </span>
          </div>

          {onTabChange && (
            <nav style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => onTabChange("catalog")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: activeTab === "catalog" ? "#f1f2f3" : "transparent",
                  color: activeTab === "catalog" ? "#008060" : "#5c5f62",
                  fontWeight: activeTab === "catalog" ? 700 : 500,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Product Catalog
              </button>
              <button
                type="button"
                onClick={() => onTabChange("orders")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: activeTab === "orders" ? "#f1f2f3" : "transparent",
                  color: activeTab === "orders" ? "#008060" : "#5c5f62",
                  fontWeight: activeTab === "orders" ? 700 : 500,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Orders & Tracking
              </button>
            </nav>
          )}
        </div>

        <RegionSelector />
      </header>

      <main style={{ padding: "24px", maxWidth: "1400px", width: "100%", margin: "0 auto", flex: 1 }}>
        {children}
      </main>
    </div>
  );
};
