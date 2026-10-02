import React from "react";
import type { OrderData } from "../../../shared/types/trends.types";
import { StatusBadge } from "../atoms/StatusBadge";
import { PriceTag } from "../atoms/PriceTag";
import { formatDate } from "../../../shared/utils/formatters";

export interface OrderSummaryCardProps {
  order: OrderData;
}

export const OrderSummaryCard: React.FC<OrderSummaryCardProps> = ({ order }) => {
  const isApproved = ["approved", "dispatched", "invoiced"].includes(
    order.status.toLowerCase()
  );
  const statusTone = isApproved
    ? "success"
    : order.status.toLowerCase().includes("hold")
    ? "warning"
    : "info";

  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        border: "1px solid #e1e3e5",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: "1px solid #f1f2f3",
          paddingBottom: "12px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#202223" }}>
              Order #{order.order_number}
            </h3>
            <StatusBadge label={order.status} tone={statusTone} size="sm" />
          </div>
          {order.purchase_order_number && (
            <span style={{ fontSize: "12px", color: "#6d7175" }}>
              PO: <strong>{order.purchase_order_number}</strong>
            </span>
          )}
        </div>

        <div style={{ textAlign: "right" }}>
          <PriceTag amount={order.value} size="lg" />
          <div style={{ fontSize: "11px", color: "#6d7175" }}>
            Ordered: {formatDate(order.order_date)}
          </div>
        </div>
      </div>

      {order.job_description && (
        <div style={{ fontSize: "13px", color: "#202223" }}>
          <strong>Job Description:</strong> {order.job_description}
        </div>
      )}

      {order.delivery_address && (
        <div style={{ fontSize: "12px", color: "#5c5f62" }}>
          <strong>Delivery To:</strong> {order.delivery_address.ship_to || "Direct Ship"} -{" "}
          {order.delivery_address.delivery_address_line_1},{" "}
          {order.delivery_address.postal_code}
        </div>
      )}

      {order.order_lines && order.order_lines.length > 0 && (
        <div style={{ marginTop: "4px" }}>
          <h4 style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", marginBottom: "8px" }}>
            Order Items ({order.order_lines.length})
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {order.order_lines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  backgroundColor: "#f9fafb",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                <div>
                  <strong style={{ color: "#202223" }}>{line.code}</strong> - {line.description}
                  <span style={{ color: "#6d7175", marginLeft: "6px" }}>
                    (Qty: {line.quantity})
                  </span>
                </div>
                <PriceTag amount={line.gross} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Media & Tracking Actions */}
      {(order.tracking || order.invoice || order.proof || order.photo) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            alignItems: "center",
            padding: "12px",
            backgroundColor: "#f4f6f8",
            borderRadius: "8px",
            border: "1px solid #e1e3e5",
          }}
        >
          {order.tracking && (
            <a
              href={order.tracking}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "#008060",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                textDecoration: "none",
                transition: "background-color 0.15s ease",
              }}
            >
              <span>🚚</span> Track Shipment
            </a>
          )}

          {order.invoice && (
            <a
              href={order.invoice}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "#ffffff",
                color: "#2c6ecb",
                border: "1px solid #c9cccf",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              <span>📄</span> Invoice {order.invoice_number ? `(${order.invoice_number})` : "PDF"}
            </a>
          )}

          {order.proof && (
            <a
              href={order.proof}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "#ffffff",
                color: "#5c5f62",
                border: "1px solid #c9cccf",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              <span>🎨</span> Artwork Proof
            </a>
          )}

          {order.photo && (
            <a
              href={order.photo}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "#ffffff",
                color: "#5c5f62",
                border: "1px solid #c9cccf",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              <span>📷</span> Production Photo
            </a>
          )}
        </div>
      )}

      {order.time_stamps && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "16px",
            paddingTop: "12px",
            borderTop: "1px solid #f1f2f3",
            fontSize: "11px",
            color: "#6d7175",
          }}
        >
          {order.time_stamps.order_received && (
            <div>
              <span style={{ color: "#8c9196" }}>Received: </span>
              <strong style={{ color: "#202223" }}>{formatDate(order.time_stamps.order_received)}</strong>
            </div>
          )}
          {order.time_stamps.last_proofed && (
            <div>
              <span style={{ color: "#8c9196" }}>Proofed: </span>
              <strong style={{ color: "#202223" }}>{formatDate(order.time_stamps.last_proofed)}</strong>
            </div>
          )}
          {order.time_stamps.order_approved && (
            <div>
              <span style={{ color: "#8c9196" }}>Approved: </span>
              <strong style={{ color: "#202223" }}>{formatDate(order.time_stamps.order_approved)}</strong>
            </div>
          )}
          {order.time_stamps.dispatch && (
            <div>
              <span style={{ color: "#8c9196" }}>Dispatched: </span>
              <strong style={{ color: "#008060" }}>{formatDate(order.time_stamps.dispatch)}</strong>
            </div>
          )}
          {order.time_stamps.invoiced && (
            <div>
              <span style={{ color: "#8c9196" }}>Invoiced: </span>
              <strong style={{ color: "#202223" }}>{formatDate(order.time_stamps.invoiced)}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
