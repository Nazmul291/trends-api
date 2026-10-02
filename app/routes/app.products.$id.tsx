import React, { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useParams, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { useProductDetailStore } from "../stores/useProductDetailStore";
import { useRegionStore } from "../stores/useRegionStore";
import { StatusBadge } from "../components/atoms/StatusBadge";
import { PriceTag } from "../components/atoms/PriceTag";
import { Button } from "../components/atoms/Button";
import { Skeleton } from "../components/atoms/Skeleton";
import { StockBadge } from "../components/molecules/StockBadge";
import { ThumbnailCarousel } from "../components/molecules/ThumbnailCarousel";
import { LeadTimeIndicator } from "../components/molecules/LeadTimeIndicator";
import { formatCurrency } from "../../shared/utils/formatters";
import type { ProductData, StockItemData } from "../../shared/types/trends.types";
import { normalizePricing } from "../../shared/types/trends.types";

/**
 * Resolves the unit price for a variant/stock line item.
 * Checks variant-level fields first, then matched product variants,
 * then falls back to the product's primary starting tier price.
 */
function getVariantPrice(
  item: StockItemData,
  product?: ProductData | null
): number | string | null {
  const rawItem = item as unknown as Record<string, unknown>;

  // 1. Check direct variant price fields
  if (rawItem.price !== undefined && rawItem.price !== null && rawItem.price !== "") {
    return rawItem.price as number | string;
  }
  if (rawItem.unit_price !== undefined && rawItem.unit_price !== null && rawItem.unit_price !== "") {
    return rawItem.unit_price as number | string;
  }
  if (rawItem.unitPrice !== undefined && rawItem.unitPrice !== null && rawItem.unitPrice !== "") {
    return rawItem.unitPrice as number | string;
  }
  if (rawItem.wholesale_price !== undefined && rawItem.wholesale_price !== null && rawItem.wholesale_price !== "") {
    return rawItem.wholesale_price as number | string;
  }

  // 2. Check matched product variants by stock code / SKU if present
  const prodAny = product as Record<string, unknown> | null | undefined;
  if (Array.isArray(prodAny?.variants)) {
    const matched = prodAny.variants.find(
      (v: any) =>
        v.sku === item.stock_code ||
        v.stock_code === item.stock_code ||
        v.code === item.stock_code ||
        String(v.id) === String(item.stock_code)
    );
    if (matched?.price !== undefined && matched?.price !== null && matched?.price !== "") {
      return matched.price;
    }
  }

  // 3. Fallback to product primary pricing tier starting price
  const pricingList = normalizePricing(product?.pricing);
  if (pricingList.length > 0 && pricingList[0].prices && pricingList[0].prices.length > 0) {
    const startingPrice = pricingList[0].prices[0].price;
    if (startingPrice !== undefined && startingPrice !== null && startingPrice !== "") {
      return startingPrice;
    }
  }

  return null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const currentRegion = useRegionStore((s) => s.currentRegion);

  const product = useProductDetailStore((s) => s.product);
  const productStatus = useProductDetailStore((s) => s.productStatus);
  const productError = useProductDetailStore((s) => s.productError);

  const stock = useProductDetailStore((s) => s.stock);
  const stockStatus = useProductDetailStore((s) => s.stockStatus);

  const leadTimes = useProductDetailStore((s) => s.leadTimes);

  const syncStatus = useProductDetailStore((s) => s.syncStatus);
  const syncError = useProductDetailStore((s) => s.syncError);
  const syncResult = useProductDetailStore((s) => s.syncResult);
  const syncProductToShopify = useProductDetailStore((s) => s.syncProductToShopify);

  const isSynced = useProductDetailStore((s) => s.isSynced);
  const shopifyProductId = useProductDetailStore((s) => s.shopifyProductId);
  const shopifyNumericId = useProductDetailStore((s) => s.shopifyNumericId);
  const shopifyShop = useProductDetailStore((s) => s.shopifyShop);
  const deleteStatus = useProductDetailStore((s) => s.deleteStatus);
  const deleteError = useProductDetailStore((s) => s.deleteError);
  const deleteProductFromShopify = useProductDetailStore((s) => s.deleteProductFromShopify);

  const loadProductDetailsWithStock = useProductDetailStore(
    (s) => s.loadProductDetailsWithStock
  );
  const fetchStock = useProductDetailStore((s) => s.fetchStock);
  const clearProduct = useProductDetailStore((s) => s.clearProduct);

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [detailImageError, setDetailImageError] = useState(false);

  useEffect(() => {
    setDetailImageError(false);
  }, [activeImageIndex, id]);

  useEffect(() => {
    if (id) {
      loadProductDetailsWithStock(id);
    }
    return () => {
      clearProduct();
    };
  }, [id, currentRegion, loadProductDetailsWithStock, clearProduct]);

  if (productStatus === "loading" && !product) {
    return (
      <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
        <Button variant="outline" size="sm" onClick={() => navigate("/app")}>
          ← Back to Catalog
        </Button>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "32px",
            marginTop: "24px",
          }}
        >
          <Skeleton height="400px" borderRadius="12px" />
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Skeleton width="40%" height="24px" />
            <Skeleton width="80%" height="32px" />
            <Skeleton width="60%" height="20px" />
            <Skeleton height="120px" borderRadius="8px" />
            <Skeleton height="80px" borderRadius="8px" />
          </div>
        </div>
      </div>
    );
  }

  if (productStatus === "error" || !product) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          maxWidth: "600px",
          margin: "40px auto",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px solid #fedcd8",
        }}
      >
        <span style={{ fontSize: "36px" }}>⚠️</span>
        <h2 style={{ fontSize: "18px", color: "#d82c0d", marginTop: "12px" }}>
          Failed to load product details
        </h2>
        <p style={{ color: "#6d7175", fontSize: "13px", marginBottom: "20px" }}>
          {productError || "The requested product code could not be retrieved from TRENDS API."}
        </p>
        <Button variant="primary" onClick={() => navigate("/app")}>
          Back to Product Catalog
        </Button>
      </div>
    );
  }

  const images = product.images || [];
  const activeImage = images[activeImageIndex]?.link || "https://placehold.co/500x500?text=No+Image";
  const pricingList = normalizePricing(product.pricing);
  const primaryPricing = pricingList[0];
  const stockList = Array.isArray(stock) && stock.length > 0 ? stock : Array.isArray(product.stock) ? product.stock : [];
  const hasStockData = stockList.length > 0;
  const totalStock = hasStockData
    ? stockList.reduce((sum, item) => sum + (typeof item.quantity === "number" ? item.quantity : Number(item.quantity) || 0), 0)
    : 0;
  const isIndent = Boolean(pricingList.some((p) => p.type?.toLowerCase() === "indent"));

  // Normalize colours: live API may return a string or string[] — always coerce to string[]
  const productColours: string[] = Array.isArray(product.colours)
    ? product.colours
    : typeof product.colours === "string" && (product.colours as string).length > 0
      ? (product.colours as string).split(",").map((c) => c.trim())
      : [];


  const adminNumericId = shopifyNumericId || shopifyProductId?.split("/").pop();
  const shopSubdomain = shopifyShop ? shopifyShop.replace(".myshopify.com", "") : null;
  const adminProductUrl = adminNumericId
    ? shopSubdomain
      ? `https://admin.shopify.com/store/${shopSubdomain}/products/${adminNumericId}`
      : `shopify:admin/products/${adminNumericId}`
    : null;

  const handleDeleteProduct = async () => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${product.name}" from your Shopify store?\n\nThis will permanently remove the Shopify product and linked variants.`
    );
    if (!confirmed) return;
    await deleteProductFromShopify();
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Top Breadcrumb & Action Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <Button variant="outline" size="sm" onClick={() => navigate("/app")}>
          ← Back to Catalog
        </Button>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <StatusBadge label={`Region: ${currentRegion.toUpperCase()}`} tone="info" size="sm" />
          <StatusBadge label={`Code: ${product.code}`} tone="neutral" size="sm" />

          {isSynced ? (
            <>
              <StatusBadge label="✓ Synced to Shopify" tone="success" size="sm" />
              {adminProductUrl && (
                <a
                  href={adminProductUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    backgroundColor: "#f1f8f5",
                    color: "#008060",
                    border: "1px solid #cbe5d8",
                    fontSize: "12px",
                    fontWeight: 600,
                    textDecoration: "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  View in Admin ↗
                </a>
              )}
              <Button
                variant="destructive"
                size="sm"
                loading={deleteStatus === "loading"}
                onClick={handleDeleteProduct}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                }
              >
                {deleteStatus === "loading" ? "Deleting..." : "Delete from Shopify"}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={syncStatus === "loading"}
              onClick={() => syncProductToShopify()}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
              }
            >
              {syncStatus === "loading" ? "Syncing to Shopify..." : "Sync to Shopify"}
            </Button>
          )}
        </div>
      </div>

      {/* Sync Status Banner */}
      {syncStatus === "success" && syncResult && (
        <div
          style={{
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "10px",
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px" }}>✅</span>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#166534" }}>
                Product successfully {syncResult.action === "created" ? "created in" : "updated on"} Shopify!
              </div>
              <div style={{ fontSize: "12px", color: "#15803d", marginTop: "2px" }}>
                Shopify ID: <code>{syncResult.shopifyProductId}</code> • {syncResult.skuList.length} canonical SKUs provisioned (Region: {currentRegion.toUpperCase()})
              </div>
            </div>
          </div>
          {syncResult.shopifyProductId && (
            <a
              href={`shopify:admin/products/${syncResult.shopifyProductId.split("/").pop()}`}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#166534",
                textDecoration: "underline",
                padding: "6px 12px",
                backgroundColor: "#dcfce7",
                borderRadius: "6px",
              }}
            >
              Open in Shopify Admin ↗
            </a>
          )}
        </div>
      )}

      {syncStatus === "error" && syncError && (
        <div
          style={{
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px" }}>❌</span>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#991b1b" }}>
                Failed to sync product to Shopify
              </div>
              <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "2px" }}>
                {syncError}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncProductToShopify()}
            style={{ color: "#991b1b", borderColor: "#fca5a5" }}
          >
            Retry Sync
          </Button>
        </div>
      )}

      {deleteStatus === "error" && deleteError && (
        <div
          style={{
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px" }}>⚠️</span>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#991b1b" }}>
                Failed to delete product from Shopify
              </div>
              <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "2px" }}>
                {deleteError}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeleteProduct}
            style={{ color: "#991b1b", borderColor: "#fca5a5" }}
          >
            Retry Delete
          </Button>
        </div>
      )}

      {/* Main Product Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "36px",
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          border: "1px solid #e1e3e5",
          padding: "32px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        {/* Left Column: Image Gallery */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              width: "100%",
              height: "440px",
              backgroundColor: "#f9fafb",
              borderRadius: "12px",
              border: "1px solid #f1f2f3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {detailImageError || !activeImage ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  color: "#8c9196",
                }}
              >
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#8c9196"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span style={{ fontSize: "13px", fontWeight: 500 }}>No image preview</span>
              </div>
            ) : (
              <img
                src={activeImage}
                alt={product.name}
                onError={() => setDetailImageError(true)}
                style={{
                  maxWidth: "92%",
                  maxHeight: "92%",
                  objectFit: "contain",
                }}
              />
            )}
          </div>

          <ThumbnailCarousel
            images={images}
            activeImageIndex={activeImageIndex}
            onSelectImage={setActiveImageIndex}
            productName={product.name}
          />
        </div>

        {/* Right Column: Product Attributes & Pricing */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
              Code: {product.code}
            </div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#202223", margin: "4px 0 8px 0" }}>
              {product.name}
            </h1>
            {product.dimensions && (
              <span style={{ fontSize: "12px", color: "#6d7175" }}>
                Dimensions: {product.dimensions}
              </span>
            )}
          </div>

          {/* Pricing Tier Card */}
          {primaryPricing && (
            <div
              style={{
                backgroundColor: "#f9fafb",
                border: "1px solid #e1e3e5",
                borderRadius: "10px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#202223" }}>
                  {primaryPricing.primary_price_description || "Quantity Break Pricing"}
                </span>
                <PriceTag
                  amount={primaryPricing.prices[0]?.price}
                  label="Starting at"
                  size="lg"
                />
              </div>

              {primaryPricing.prices && primaryPricing.prices.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(primaryPricing.prices.length, 6)}, 1fr)`, gap: "8px", marginTop: "4px" }}>
                  {primaryPricing.prices.map((p, pIdx) => (
                    <div
                      key={pIdx}
                      style={{
                        backgroundColor: "#ffffff",
                        padding: "8px",
                        borderRadius: "6px",
                        border: "1px solid #e1e3e5",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "11px", color: "#6d7175" }}>{p.quantity}+</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#008060" }}>
                        {formatCurrency(p.price, currentRegion)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Available Colours */}
          {productColours.length > 0 && (
            <div>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#202223", display: "block", marginBottom: "6px" }}>
                Available Colours ({productColours.length})
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {productColours.map((col, idx) => (
                  <span
                    key={idx}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "6px",
                      backgroundColor: "#f1f2f3",
                      fontSize: "12px",
                      color: "#202223",
                    }}
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {product.description && (
            <div>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#202223", display: "block", marginBottom: "4px" }}>
                Description
              </span>
              <p style={{ fontSize: "13px", color: "#5c5f62", lineHeight: "1.5", margin: 0 }}>
                {product.description}
              </p>
            </div>
          )}

          {/* Lead Times */}
          <LeadTimeIndicator leadTimes={leadTimes} />
        </div>
      </div>

      {/* Real-Time Stock Breakdown Section */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          border: "1px solid #e1e3e5",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#202223" }}>
              Live Warehouse Stock Breakdown
            </h3>
            <span style={{ fontSize: "12px", color: "#6d7175" }}>
              Total Available: <strong style={{ color: "#202223" }}>{totalStock.toLocaleString()}</strong> units across {stock.length} variants
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            loading={stockStatus === "loading"}
            onClick={() => id && fetchStock(id, { bypassCache: true })}
          >
            ⚡ Refresh Stock (Bypass Cache)
          </Button>
        </div>

        {stock.length === 0 && stockStatus !== "loading" ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#6d7175", fontSize: "13px" }}>
            No stock line items reported for this product.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ padding: "10px 14px", fontSize: "12px", color: "#6d7175" }}>Stock Code</th>
                  <th style={{ padding: "10px 14px", fontSize: "12px", color: "#6d7175" }}>Variant Description</th>
                  <th style={{ padding: "10px 14px", fontSize: "12px", color: "#6d7175" }}>Available Stock</th>
                  <th style={{ padding: "10px 14px", fontSize: "12px", color: "#6d7175" }}>Price</th>
                  <th style={{ padding: "10px 14px", fontSize: "12px", color: "#6d7175" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((item, idx) => {
                  const variantPrice = getVariantPrice(item, product);
                  return (
                    <tr key={idx} style={{ borderBottom: "1px solid #f1f2f3" }}>
                      <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600 }}>{item.stock_code}</td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", color: "#5c5f62" }}>{item.description}</td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 700 }}>
                        {(Number(item.quantity) || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#202223" }}>
                        {variantPrice !== null && variantPrice !== undefined ? (
                          formatCurrency(variantPrice, currentRegion)
                        ) : (
                          <span style={{ color: "#8c9196" }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <StockBadge
                          quantity={typeof item.quantity === "number" ? item.quantity : Number(item.quantity) || 0}
                          nextShipment={item.next_shipment && item.next_shipment > 0 ? item.next_shipment : undefined}
                          dueDate={item.due_date && item.due_date !== "-" ? item.due_date : null}
                          size="sm"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
