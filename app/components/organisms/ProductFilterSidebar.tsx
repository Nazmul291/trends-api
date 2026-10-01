import React, { useEffect } from "react";
import { useCatalogStore } from "../../stores/useCatalogStore";

export const ProductFilterSidebar: React.FC = () => {
  const categories = useCatalogStore((s) => s.categories);
  const categoriesStatus = useCatalogStore((s) => s.categoriesStatus);
  const selectedCategory = useCatalogStore((s) => s.filters.categoryNo);
  const incDiscontinued = useCatalogStore((s) => s.filters.incDiscontinued);
  const fetchCategories = useCatalogStore((s) => s.fetchCategories);
  const setSelectedCategory = useCatalogStore((s) => s.setSelectedCategory);
  const resetFilters = useCatalogStore((s) => s.resetFilters);

  useEffect(() => {
    if (categories.length === 0 && categoriesStatus === "idle") {
      fetchCategories();
    }
  }, [categories.length, categoriesStatus, fetchCategories]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        border: "1px solid #e1e3e5",
        padding: "16px",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", boxSizing: "border-box" }}>
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#202223", margin: 0 }}>
          Categories
        </h3>
        {selectedCategory !== null && (
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            style={{
              background: "none",
              border: "none",
              fontSize: "12px",
              color: "#008060",
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          maxHeight: "360px",
          overflowY: "auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedCategory(null)}
          style={{
            textAlign: "left",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: selectedCategory === null ? "#f1f2f3" : "transparent",
            color: selectedCategory === null ? "#202223" : "#5c5f62",
            fontWeight: selectedCategory === null ? 700 : 500,
            fontSize: "13px",
            cursor: "pointer",
            width: "100%",
            boxSizing: "border-box",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          All Categories
        </button>

        {categories.map((cat) => {
          const isSelected = String(selectedCategory) === String(cat.id) || selectedCategory === cat.number;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: isSelected ? "#f1f2f3" : "transparent",
                color: isSelected ? "#008060" : "#5c5f62",
                fontWeight: isSelected ? 700 : 500,
                fontSize: "13px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                maxWidth: "100%",
                boxSizing: "border-box",
                gap: "8px",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: "1 1 0%",
                  minWidth: 0,
                }}
              >
                {cat.name}
              </span>
              {cat.number && (
                <span
                  style={{
                    fontSize: "11px",
                    color: "#8c9196",
                    flexShrink: 0,
                  }}
                >
                  #{cat.number}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ paddingTop: "12px", borderTop: "1px solid #f1f2f3", width: "100%", boxSizing: "border-box" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "#5c5f62",
            cursor: "pointer",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <input
            type="checkbox"
            checked={incDiscontinued}
            onChange={(e) => fetchCategories({ incDiscontinued: e.target.checked })}
            style={{ borderRadius: "4px", accentColor: "#008060", flexShrink: 0 }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Include Discontinued Items
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={() => resetFilters()}
        style={{
          padding: "8px",
          backgroundColor: "#f6f6f7",
          border: "1px solid #c9cccf",
          borderRadius: "6px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#202223",
          cursor: "pointer",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        Reset Filters
      </button>
    </div>
  );
};
