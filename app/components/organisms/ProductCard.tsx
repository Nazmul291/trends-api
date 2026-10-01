import React from "react";
import type { ProductData } from "../../../shared/types/trends.types";
import { PriceTag } from "../atoms/PriceTag";
import { StockBadge } from "../molecules/StockBadge";

export interface ProductCardProps {
  product: ProductData;
  onClick?: (product: ProductData) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onClick }) => {
  const primaryImage = product.images?.[0]?.link || "";
  const primaryPricing = product.pricing?.[0]?.prices?.[0]?.price;
  const [hasImageError, setHasImageError] = React.useState(false);

  React.useEffect(() => {
    setHasImageError(false);
  }, [primaryImage]);

  // Calculate total stock across all variants/stock items
  const totalStock = product.stock?.reduce((acc, curr) => acc + (curr.quantity || 0), 0) || 0;
  const nextShipment = product.stock?.find((s) => s.next_shipment && s.next_shipment > 0);

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

        {product.colours && product.colours.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {product.colours.slice(0, 4).map((c, i) => (
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
            {product.colours.length > 4 && (
              <span style={{ fontSize: "10px", color: "#8c9196" }}>
                +{product.colours.length - 4} more
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
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          {primaryPricing ? (
            <PriceTag amount={primaryPricing} label="From" size="md" />
          ) : (
            <span style={{ fontSize: "12px", color: "#6d7175", fontWeight: 500 }}>
              Price on request
            </span>
          )}
          <StockBadge
            quantity={totalStock}
            nextShipment={nextShipment?.next_shipment}
            dueDate={nextShipment?.due_date}
            size="sm"
          />
        </div>
      </div>
    </div>
  );
};
