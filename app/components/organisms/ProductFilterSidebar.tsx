import React from "react";
import { useCatalogStore } from "../../stores/useCatalogStore";

export interface CatalogCategoryOption {
  id: string; // The category_no query parameter recognized by Trends API
  name: string;
  icon?: string;
}

/**
 * Top 6 high-volume catalog categories derived from real Trends API catalog data:
 * - Leisure & Outdoors (10-0): 578 products
 * - Bags (1-0): 441 products
 * - Drinkware (4-0): 346 products
 * - Technology (12-0): 205 products
 * - Apparel (14-0): 187 products
 * - Pens & Writing (13-0): 167 products
 */
export const TOP_CATALOG_CATEGORIES: CatalogCategoryOption[] = [
  { id: "4-0", name: "Drinkware", icon: "🍶" },
  { id: "1-0", name: "Bags", icon: "🎒" },
  { id: "10-0", name: "Leisure & Outdoors", icon: "🏕️" },
  { id: "13-0", name: "Pens & Writing", icon: "🖊️" },
  { id: "14-0", name: "Apparel", icon: "👕" },
  { id: "12-0", name: "Technology", icon: "⚡" },
];

export const ProductFilterSidebar: React.FC = () => {
  const selectedCategory = useCatalogStore((s) => s.filters.categoryNo);
  const incDiscontinued = useCatalogStore((s) => s.filters.incDiscontinued);
  const setSelectedCategory = useCatalogStore((s) => s.setSelectedCategory);
  const setIncDiscontinued = useCatalogStore((s) => s.setIncDiscontinued);
  const resetFilters = useCatalogStore((s) => s.resetFilters);

  const isAllSelected = selectedCategory === null || selectedCategory === "" || selectedCategory === undefined;

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
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#202223", margin: 0 }}>
          Categories
        </h3>
        {!isAllSelected && (
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

      {/* Category List Wrapper with generous top padding to eliminate vertical clipping */}
      <div
        className="trends-category-list pt-2"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          padding: "6px 2px 2px 2px",
          paddingTop: "8px",
          maxHeight: "380px",
          overflowY: "auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* All Categories Button */}
        <button
          type="button"
          onClick={() => setSelectedCategory(null)}
          style={{
            textAlign: "left",
            padding: "9px 12px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: isAllSelected ? "#e6f4ea" : "transparent",
            color: isAllSelected ? "#008060" : "#202223",
            fontWeight: isAllSelected ? 700 : 500,
            fontSize: "13px",
            cursor: "pointer",
            width: "100%",
            boxSizing: "border-box",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            transition: "all 0.15s ease-in-out",
          }}
          onMouseEnter={(e) => {
            if (!isAllSelected) e.currentTarget.style.backgroundColor = "#f6f6f7";
          }}
          onMouseLeave={(e) => {
            if (!isAllSelected) e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <span style={{ fontSize: "14px", lineHeight: 1 }}>🏷️</span>
          <span style={{ flex: "1 1 0%", minWidth: 0 }}>All Categories</span>
          {isAllSelected && (
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "#008060",
                flexShrink: 0,
              }}
            />
          )}
        </button>

        {/* Top 6 Valid Active Categories */}
        {TOP_CATALOG_CATEGORIES.map((cat) => {
          const isSelected = String(selectedCategory) === String(cat.id);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                textAlign: "left",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: isSelected ? "#e6f4ea" : "transparent",
                color: isSelected ? "#008060" : "#202223",
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
                transition: "all 0.15s ease-in-out",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.backgroundColor = "#f6f6f7";
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: "1 1 0%",
                  minWidth: 0,
                }}
              >
                {cat.icon && <span style={{ fontSize: "14px", lineHeight: 1 }}>{cat.icon}</span>}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cat.name}
                </span>
              </span>
              {isSelected && (
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: "#008060",
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Discontinued items checkbox */}
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
            onChange={(e) => setIncDiscontinued(e.target.checked)}
            style={{ borderRadius: "4px", accentColor: "#008060", flexShrink: 0 }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Include Discontinued Items
          </span>
        </label>
      </div>

      {/* Reset Filters button */}
      <button
        type="button"
        onClick={() => resetFilters()}
        style={{
          padding: "9px 12px",
          backgroundColor: "#f6f6f7",
          border: "1px solid #c9cccf",
          borderRadius: "6px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#202223",
          cursor: "pointer",
          width: "100%",
          boxSizing: "border-box",
          transition: "all 0.15s ease-in-out",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#e4e5e7";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "#f6f6f7";
        }}
      >
        Reset Filters
      </button>
    </div>
  );
};
