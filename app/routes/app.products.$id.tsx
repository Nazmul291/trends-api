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
import { LeadTimeIndicator } from "../components/molecules/LeadTimeIndicator";
import { formatCurrency } from "../../shared/utils/formatters";

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
  const primaryPricing = product.pricing?.[0];
  const totalStock = stock.reduce((sum, item) => sum + (item.quantity || 0), 0);

  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Top Breadcrumb Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Button variant="outline" size="sm" onClick={() => navigate("/app")}>
          ← Back to Catalog
        </Button>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <StatusBadge label={`Region: ${currentRegion.toUpperCase()}`} tone="info" size="sm" />
          <StatusBadge label={product.code} tone="neutral" size="sm" />
        </div>
      </div>

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

          {images.length > 1 && (
            <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
              {images.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveImageIndex(idx)}
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "8px",
                    border: `2px solid ${activeImageIndex === idx ? "#008060" : "#e1e3e5"}`,
                    backgroundColor: "#f9fafb",
                    padding: "2px",
                    cursor: "pointer",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={img.link}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                </button>
              ))}
            </div>
          )}
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
          {product.colours && product.colours.length > 0 && (
            <div>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#202223", display: "block", marginBottom: "6px" }}>
                Available Colours ({product.colours.length})
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {product.colours.map((col, idx) => (
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
                  <th style={{ padding: "10px 14px", fontSize: "12px", color: "#6d7175" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600 }}>{item.stock_code}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#5c5f62" }}>{item.description}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 700 }}>
                      {item.quantity.toLocaleString()}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <StockBadge
                        quantity={item.quantity}
                        nextShipment={item.next_shipment}
                        dueDate={item.due_date}
                        size="sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
