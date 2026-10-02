import React from "react";
import type { ProductData } from "../../../shared/types/trends.types";
import { PriceTag } from "../atoms/PriceTag";
import { StockBadge } from "../molecules/StockBadge";

export interface ProductCardProps {
  product: ProductData;
  onClick?: (product: ProductData) => void;
  onSync?: (product: ProductData) => void;
  isSyncing?: boolean;
  isSynced?: boolean;
  onDelete?: (product: ProductData) => void;
  isDeleting?: boolean;
  shopifyAdminUrl?: string;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onClick,
  onSync,
  isSyncing = false,
  isSynced = false,
  onDelete,
  isDeleting = false,
  shopifyAdminUrl,
}) => {
  const primaryImage = product.images?.[0]?.link || "";
  const primaryPricing = product.pricing?.[0]?.prices?.[0]?.price;
  const [hasImageError, setHasImageError] = React.useState(false);

  React.useEffect(() => {
    setHasImageError(false);
  }, [primaryImage]);

  // Normalize colours: live API may return a string or string[] — always coerce to string[]
  const colours: string[] = Array.isArray(product.colours)
    ? product.colours
    : typeof product.colours === "string" && (product.colours as string).length > 0
      ? (product.colours as string).split(",").map((c) => c.trim())
      : [];

  // Calculate total stock across all variants/stock items
  const stockList = Array.isArray(product.stock) ? product.stock : [];
  const hasStock = stockList.length > 0;
  const totalStock = hasStock
    ? stockList.reduce((acc, curr) => acc + (typeof curr.quantity === "number" ? curr.quantity : Number(curr.quantity) || 0), 0)
    : null;
  const nextShipment = stockList.find((s) => s.next_shipment && s.next_shipment > 0);
  const isIndent = Boolean(product.pricing?.some((p) => p.type?.toLowerCase() === "indent"));

  return (
    <div
      onClick={() => onClick?.(product)}
      style={{
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        border: "1px solid #e1e3e5",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.2s ease-in-out",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 16px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
      }}
    >
      <div
        style={{
          width: "100%",
          height: "200px",
          backgroundColor: "#f9fafb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {hasImageError || !primaryImage ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              color: "#8c9196",
              width: "100%",
              height: "100%",
              backgroundColor: "#f4f6f8",
              padding: "16px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "50%",
                backgroundColor: "#e4e5e7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "2px",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6d7175"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#6d7175" }}>
              No image available
            </span>
          </div>
        ) : (
          <img
            src={primaryImage}
            alt=""
            loading="lazy"
            onError={() => setHasImageError(true)}
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              objectFit: "contain",
              transition: "transform 0.2s ease-in-out",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            backgroundColor: "rgba(0,0,0,0.7)",
            color: "#ffffff",
            padding: "2px 8px",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: 600,
          }}
        >
          {product.code}
        </div>

        {isSynced && (
          <div
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              backgroundColor: "#008060",
              color: "#ffffff",
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "10px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "3px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }}
          >
            ✓ Synced
          </div>
        )}
      </div>

      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
        <h4
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "#202223",
            margin: 0,
            lineHeight: "1.3",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {product.name}
        </h4>

        {colours.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {colours.slice(0, 4).map((c, i) => (
              <span
                key={i}
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  backgroundColor: "#f1f2f3",
                  borderRadius: "4px",
                  color: "#5c5f62",
                }}
              >
                {c}
              </span>
            ))}
            {colours.length > 4 && (
              <span style={{ fontSize: "10px", color: "#8c9196" }}>
                +{colours.length - 4} more
              </span>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: "auto",
            paddingTop: "12px",
            borderTop: "1px solid #f1f2f3",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <div>
            {primaryPricing ? (
              <PriceTag amount={primaryPricing} label="From" size="md" />
            ) : (
              <span style={{ fontSize: "12px", color: "#6d7175", fontWeight: 500 }}>
                Price on request
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <StockBadge
              quantity={totalStock}
              isUntracked={!hasStock && isIndent}
              pricingType={product.pricing?.[0]?.type}
              nextShipment={nextShipment?.next_shipment}
              dueDate={nextShipment?.due_date}
              size="sm"
            />
            {isSynced ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {shopifyAdminUrl && (
                  <a
                    href={shopifyAdminUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="Open in Shopify Admin"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "28px",
                      height: "28px",
                      borderRadius: "6px",
                      border: "1px solid #cbe5d8",
                      backgroundColor: "#f1f8f5",
                      color: "#008060",
                      textDecoration: "none",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(product);
                    }}
                    disabled={isDeleting}
                    title="Delete product from Shopify"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "28px",
                      height: "28px",
                      borderRadius: "6px",
                      border: "1px solid #fecaca",
                      backgroundColor: isDeleting ? "#fee2e2" : "#ffffff",
                      color: "#d82c0d",
                      cursor: isDeleting ? "not-allowed" : "pointer",
                      transition: "all 0.15s ease",
                      padding: 0,
                    }}
                  >
                    {isDeleting ? (
                      <span
                        style={{
                          width: "12px",
                          height: "12px",
                          border: "2px solid #d82c0d",
                          borderTopColor: "transparent",
                          borderRadius: "50%",
                          animation: "trends-spin 0.6s linear infinite",
                        }}
                      />
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            ) : (
              onSync && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSync(product);
                  }}
                  disabled={isSyncing}
                  title="Sync product to Shopify"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    borderRadius: "6px",
                    border: "1px solid #008060",
                    backgroundColor: isSyncing ? "#e3f1df" : "#ffffff",
                    color: "#008060",
                    cursor: isSyncing ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease",
                    padding: 0,
                  }}
                >
                  {isSyncing ? (
                    <span
                      style={{
                        width: "12px",
                        height: "12px",
                        border: "2px solid #008060",
                        borderTopColor: "transparent",
                        borderRadius: "50%",
                        animation: "trends-spin 0.6s linear infinite",
                      }}
                    />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                    </svg>
                  )}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
