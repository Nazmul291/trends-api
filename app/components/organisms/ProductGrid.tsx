import React from "react";
import type { ProductData } from "../../../shared/types/trends.types";
import { ProductCard } from "./ProductCard";
import { CardSkeleton } from "../atoms/Skeleton";
import { useCatalogStore } from "../../stores/useCatalogStore";

export interface ProductGridProps {
  onProductClick?: (product: ProductData) => void;
}

export const ProductGrid: React.FC<ProductGridProps> = ({ onProductClick }) => {
  const products = useCatalogStore((s) => s.products);
  const status = useCatalogStore((s) => s.productsStatus);
  const error = useCatalogStore((s) => s.productsError);
  const syncingProductId = useCatalogStore((s) => s.syncingProductId);
  const deletingProductId = useCatalogStore((s) => s.deletingProductId);
  const syncedProductMap = useCatalogStore((s) => s.syncedProductMap);
  const syncProductToShopify = useCatalogStore((s) => s.syncProductToShopify);
  const deleteProductFromShopify = useCatalogStore((s) => s.deleteProductFromShopify);
  const resetFilters = useCatalogStore((s) => s.resetFilters);
  const fetchProducts = useCatalogStore((s) => s.fetchProducts);
  const fetchCategories = useCatalogStore((s) => s.fetchCategories);

  const handleDeleteProduct = (product: ProductData) => {
    const confirmed = window.confirm(
      `Delete "${product.name}" from your Shopify store?\n\nThis will permanently remove the Shopify product and all variants.`
    );
    if (!confirmed) return;
    deleteProductFromShopify(product);
  };

  const handleTryAgain = () => {
    fetchCategories({ bypassCache: true });
    fetchProducts({ bypassCache: true, pageNo: 1 });
  };

  if (status === "loading" && products.length === 0) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "24px",
          width: "100%",
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (status === "error") {
    const isAuthError = error?.includes("401") || error?.toLowerCase().includes("credential");

    return (
      <div
        style={{
          padding: "36px 24px",
          textAlign: "center",
          backgroundColor: "#fef1f0",
          borderRadius: "12px",
          border: "1px solid #fedcd8",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <span style={{ fontSize: "32px" }}>⚠️</span>
        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#d82c0d", margin: 0 }}>
          Failed to load catalog products
        </h3>
        <p style={{ fontSize: "13px", color: "#6d7175", maxWidth: "560px", margin: 0, lineHeight: "1.5" }}>
          {error}
        </p>
        {isAuthError && (
          <div
            style={{
              padding: "10px 16px",
              backgroundColor: "#ffffff",
              borderRadius: "8px",
              border: "1px dashed #d82c0d",
              fontSize: "12px",
              color: "#5c5f62",
              textAlign: "left",
              maxWidth: "520px",
              marginTop: "4px",
            }}
          >
            <strong>💡 Setup Tip:</strong> Add your regional API token to <code>.env</code>:
            <pre style={{ margin: "6px 0 0 0", padding: "6px 8px", backgroundColor: "#f6f6f7", borderRadius: "4px" }}>
              TRENDS_API_KEY_NZ=your_bearer_token_here
            </pre>
            Or set <code>ENABLE_TRENDS_MOCK_FALLBACK=true</code> for local UI development.
          </div>
        )}
        <button
          type="button"
          onClick={handleTryAgain}
          style={{
            marginTop: "8px",
            padding: "8px 20px",
            backgroundColor: "#d82c0d",
            border: "none",
            color: "#ffffff",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
          }}
        >
          🔄 Try Again (Refresh Cache)
        </button>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div
        style={{
          padding: "64px 24px",
          textAlign: "center",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px dashed #c9cccf",
        }}
      >
        <span style={{ fontSize: "32px" }}>🔍</span>
        <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginTop: "8px" }}>
          No products found
        </h3>
        <p style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>
          Try clearing your search filters or selecting another category.
        </p>
        <button
          type="button"
          onClick={() => resetFilters()}
          style={{
            padding: "8px 16px",
            backgroundColor: "#008060",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reset All Filters
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: "24px",
        width: "100%",
      }}
    >
      {products.map((product) => {
        const syncInfo = syncedProductMap[product.code];
        const isSynced = Boolean(syncInfo?.isSynced);
        const adminUrl = syncInfo?.shopifyNumericId
          ? `shopify:admin/products/${syncInfo.shopifyNumericId}`
          : syncInfo?.shopifyProductId
          ? `shopify:admin/products/${syncInfo.shopifyProductId.split("/").pop()}`
          : undefined;

        return (
          <ProductCard
            key={product.code}
            product={product}
            onClick={onProductClick}
            isSynced={isSynced}
            shopifyAdminUrl={adminUrl}
            onSync={(p) => syncProductToShopify(p)}
            isSyncing={syncingProductId === product.code}
            onDelete={handleDeleteProduct}
            isDeleting={deletingProductId === product.code}
          />
        );
      })}
    </div>
  );
};
