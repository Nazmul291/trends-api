import React from "react";
import { Button } from "../atoms/Button";
import { useCatalogStore } from "../../stores/useCatalogStore";

export const PaginationControls: React.FC = () => {
  const pagination = useCatalogStore((s) => s.pagination);
  const setPage = useCatalogStore((s) => s.setPage);
  const isLoading = useCatalogStore((s) => s.productsStatus === "loading");

  const { pageCurrent, pageCount, totalItems } = pagination;

  if (pageCount <= 1 && totalItems <= 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 0",
        borderTop: "1px solid #e1e3e5",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: "13px", color: "#6d7175" }}>
        Showing page <strong style={{ color: "#202223" }}>{pageCurrent}</strong> of{" "}
        <strong style={{ color: "#202223" }}>{pageCount}</strong> ({totalItems.toLocaleString()}{" "}
        items)
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Button
          variant="outline"
          size="sm"
          disabled={pageCurrent <= 1 || isLoading}
          onClick={() => setPage(pageCurrent - 1)}
        >
          Previous
        </Button>

        <span style={{ fontSize: "13px", fontWeight: 600, padding: "0 8px" }}>
          {pageCurrent}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={pageCurrent >= pageCount || isLoading}
          onClick={() => setPage(pageCurrent + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
};
