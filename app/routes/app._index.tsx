import React, { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useCatalogStore } from "../stores/useCatalogStore";
import { useRegionStore } from "../stores/useRegionStore";
import { CatalogLayout } from "../components/templates/CatalogLayout";
import { StatusBadge } from "../components/atoms/StatusBadge";
import { getAppSettings } from "../../server/settings/app-settings.service";
import type { ProductData, Region } from "../../shared/types/trends.types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getAppSettings(session.shop);
  const enabledRegions = settings.enabledRegions as Region[];

  const url = new URL(request.url);
  const queryRegion = url.searchParams.get("region")?.toLowerCase() as Region | undefined;
  const activeRegion: Region =
    queryRegion && enabledRegions.includes(queryRegion)
      ? queryRegion
      : enabledRegions[0];

  return {
    enabledRegions,
    activeRegion,
  };
};

export default function CatalogIndexPage() {
  const navigate = useNavigate();
  const { enabledRegions, activeRegion } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentRegion = useRegionStore((s) => s.currentRegion);
  const isInitialized = useRegionStore((s) => s.isInitialized);
  const setEnabledRegions = useRegionStore((s) => s.setEnabledRegions);

  const products = useCatalogStore((s) => s.products);
  const productsStatus = useCatalogStore((s) => s.productsStatus);
  const fetchProducts = useCatalogStore((s) => s.fetchProducts);
  const fetchCategories = useCatalogStore((s) => s.fetchCategories);

  // Synchronize store immediately with DB settings from loader
  useEffect(() => {
    setEnabledRegions(enabledRegions, activeRegion);
  }, [enabledRegions, activeRegion, setEnabledRegions]);

  // Sanitize URL and Client State:
  // Inspect URL query parameters on page load.
  // If the requested region is missing or not included in active settings,
  // immediately reassign it to the enabled region and update URL query string.
  useEffect(() => {
    const rawParam = searchParams.get("region");
    const queryRegion = rawParam ? (rawParam.toLowerCase() as Region) : null;
    const targetRegion =
      queryRegion && enabledRegions.includes(queryRegion)
        ? queryRegion
        : (enabledRegions.includes(currentRegion) ? currentRegion : activeRegion);

    if (queryRegion !== targetRegion) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("region", targetRegion);
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, enabledRegions, currentRegion, activeRegion, setSearchParams]);

  // Fetch catalog products and category tree strictly when the store is initialized
  // and the currentRegion is verified against enabledRegions
  useEffect(() => {
    if (isInitialized && enabledRegions.includes(currentRegion)) {
      fetchCategories();
      fetchProducts({ pageNo: 1 });
    }
  }, [currentRegion, isInitialized, enabledRegions, fetchCategories, fetchProducts]);

  const handleProductClick = (product: ProductData) => {
    navigate(`/app/products/${product.code}`);
  };

  const displayRegion = (enabledRegions.includes(currentRegion) ? currentRegion : activeRegion).toUpperCase();

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
            Browse live promotional inventory, branding methods, and tiered quantity breaks for {displayRegion}
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
