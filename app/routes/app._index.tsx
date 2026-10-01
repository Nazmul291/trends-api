import React, { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useNavigate, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useCatalogStore } from "../stores/useCatalogStore";
import { useRegionStore } from "../stores/useRegionStore";
import { CatalogLayout } from "../components/templates/CatalogLayout";
import { StatusBadge } from "../components/atoms/StatusBadge";
import type { ProductData } from "../../shared/types/trends.types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function CatalogIndexPage() {
  const navigate = useNavigate();

  const currentRegion = useRegionStore((s) => s.currentRegion);
  const products = useCatalogStore((s) => s.products);
  const productsStatus = useCatalogStore((s) => s.productsStatus);
  const fetchProducts = useCatalogStore((s) => s.fetchProducts);
  const fetchCategories = useCatalogStore((s) => s.fetchCategories);

  useEffect(() => {
    // Initial fetch of catalog products and category tree
    fetchCategories();
    fetchProducts({ pageNo: 1 });
  }, [currentRegion, fetchCategories, fetchProducts]);

  const handleProductClick = (product: ProductData) => {
    navigate(`/app/products/${product.code}`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Top Section */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "#ffffff",
          padding: "16px 20px",
          borderRadius: "12px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        }}
      >
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#202223" }}>
            Promotional Products Catalog
          </h1>
          <span style={{ fontSize: "13px", color: "#6d7175" }}>
            Browse live promotional inventory, branding methods, and tiered quantity breaks for {currentRegion.toUpperCase()}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <StatusBadge
            label={productsStatus === "loading" ? "Syncing..." : `${products.length} Products`}
            tone={productsStatus === "loading" ? "info" : "success"}
            size="sm"
            dot
          />
        </div>
      </div>

      {/* Main Catalog 2-Column Grid */}
      <CatalogLayout onProductClick={handleProductClick} />
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
