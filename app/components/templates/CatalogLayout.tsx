import React from "react";
import { ProductFilterSidebar } from "../organisms/ProductFilterSidebar";
import { ProductGrid } from "../organisms/ProductGrid";
import { SearchInput } from "../molecules/SearchInput";
import { PaginationControls } from "../molecules/PaginationControls";
import type { ProductData } from "../../../shared/types/trends.types";

export interface CatalogLayoutProps {
  onProductClick?: (product: ProductData) => void;
}

export const CatalogLayout: React.FC<CatalogLayoutProps> = ({ onProductClick }) => {
  return (
    <div className="trends-catalog-layout">
      <style>{`
        .trends-catalog-layout {
          display: flex;
          flex-direction: column;
          gap: 24px;
          width: 100%;
          box-sizing: border-box;
          align-items: stretch;
        }

        .trends-catalog-aside {
          width: 100%;
          box-sizing: border-box;
        }

        .trends-catalog-main {
          flex: 1 1 0%;
          min-width: 0;
          width: 100%;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }

        @media (min-width: 1024px) {
          .trends-catalog-layout {
            flex-direction: row;
            align-items: flex-start;
            gap: 32px;
          }

          .trends-catalog-aside {
            width: 260px !important;
            min-width: 260px !important;
            max-width: 260px !important;
            flex-shrink: 0 !important;
          }
        }
      `}</style>

      {/* Left Column (Sidebar): Rigid constraint of 260px on desktop */}
      <aside
        className="trends-catalog-aside"
        style={{
          width: "260px",
          minWidth: "260px",
          maxWidth: "260px",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        <ProductFilterSidebar />
      </aside>

      {/* Right Column (Main Content): Fluid width with flex: 1 1 0% and minWidth: 0 */}
      <main
        className="trends-catalog-main"
        style={{
          flex: "1 1 0%",
          minWidth: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        {/* Top: SearchInput (full width, mb-6 / 24px) */}
        <div style={{ width: "100%", marginBottom: "24px" }}>
          <SearchInput />
        </div>

        {/* Middle: ProductGrid */}
        <div style={{ width: "100%" }}>
          <ProductGrid onProductClick={onProductClick} />
        </div>

        {/* Bottom: PaginationControls (aligned in a single flex row, mt-8 / 32px) */}
        <div style={{ width: "100%", marginTop: "32px" }}>
          <PaginationControls />
        </div>
      </main>
    </div>
  );
};
