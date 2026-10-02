import React, { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../../server/settings/app-settings.service";
import { getOrders } from "../../server/services/trends.server";
import type { Region, OrderData } from "../../shared/types/trends.types";
import { OrderSummaryCard } from "../components/organisms/OrderSummaryCard";
import { DataTable, type ColumnDef } from "../components/organisms/DataTable";
import { Input } from "../components/atoms/Input";
import { Button } from "../components/atoms/Button";
import { StatusBadge, type BadgeTone } from "../components/atoms/StatusBadge";
import { PriceTag } from "../components/atoms/PriceTag";
import { formatDate } from "../../shared/utils/formatters";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getAppSettings(session.shop);
  const enabledRegions = (settings.enabledRegions || ["nz"]) as Region[];

  const url = new URL(request.url);
  const requestedRegion = (url.searchParams.get("region")?.toLowerCase() || "") as Region;
  const region: Region = enabledRegions.includes(requestedRegion)
    ? requestedRegion
    : enabledRegions[0] || "nz";

  const salesordernum = url.searchParams.get("salesordernum") || undefined;
  const ponum = url.searchParams.get("ponum") || undefined;

  let orders: OrderData[] = [];
  let error: string | null = null;

  try {
    orders = await getOrders({
      region,
      shop: session.shop,
      salesordernum,
      ponum,
    });
  } catch (err: unknown) {
    console.error("[OrdersPage Loader Error]:", err);
    error =
      (err as { message?: string })?.message ||
      "Failed to fetch orders from Trends API. Please check your credentials in Settings.";
  }

  return {
    orders,
    error,
    region,
    enabledRegions,
    query: {
      salesordernum: salesordernum || "",
      ponum: ponum || "",
    },
  };
};

export default function OrdersPage() {
  const { orders, error, region, enabledRegions, query } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [salesOrderNum, setSalesOrderNum] = useState(query.salesordernum);
  const [poNum, setPoNum] = useState(query.ponum);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [selectedOrder, setSelectedOrder] = useState<OrderData | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    params.set("region", region);
    if (salesOrderNum.trim()) params.set("salesordernum", salesOrderNum.trim());
    if (poNum.trim()) params.set("ponum", poNum.trim());
    submit(params, { method: "get" });
  };

  const handleClear = () => {
    setSalesOrderNum("");
    setPoNum("");
    const params = new URLSearchParams();
    params.set("region", region);
    submit(params, { method: "get" });
  };

  const handleRegionChange = (newRegion: Region) => {
    const params = new URLSearchParams();
    params.set("region", newRegion);
    if (salesOrderNum.trim()) params.set("salesordernum", salesOrderNum.trim());
    if (poNum.trim()) params.set("ponum", poNum.trim());
    submit(params, { method: "get" });
  };

  // Helper to determine status badge tone
  const getStatusTone = (status: string): BadgeTone => {
    const s = status.toLowerCase();
    if (["approved", "dispatched", "invoiced", "delivered"].includes(s)) return "success";
    if (s.includes("hold") || s.includes("pending")) return "warning";
    if (s.includes("cancel") || s.includes("reject")) return "critical";
    return "info";
  };

  // Columns for the Live Orders DataTable
  const columns: ColumnDef<OrderData>[] = [
    {
      header: "Order & PO #",
      accessorKey: "order_number",
      width: "180px",
      cell: (order) => (
        <div>
          <div style={{ fontWeight: 700, color: "#202223" }}>#{order.order_number}</div>
          {order.purchase_order_number && (
            <div style={{ fontSize: "11px", color: "#6d7175" }}>
              PO: <strong>{order.purchase_order_number}</strong>
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Status",
      accessorKey: "status",
      width: "140px",
      cell: (order) => (
        <StatusBadge
          label={order.status}
          tone={getStatusTone(order.status)}
          size="sm"
          dot
        />
      ),
    },
    {
      header: "Product / Job",
      accessorKey: "job_description",
      cell: (order) => (
        <div>
          <div style={{ fontWeight: 600, color: "#202223" }}>
            {order.product || order.job_description || "Promotional Merchandise"}
          </div>
          {order.quantity > 0 && (
            <div style={{ fontSize: "11px", color: "#6d7175" }}>
              Qty: {order.quantity} units {order.order_lines ? `(${order.order_lines.length} lines)` : ""}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Value",
      accessorKey: "value",
      width: "110px",
      cell: (order) => <PriceTag amount={order.value} size="sm" />,
    },
    {
      header: "Key Dates",
      width: "150px",
      cell: (order) => (
        <div style={{ fontSize: "11px", color: "#5c5f62", display: "flex", flexDirection: "column", gap: "2px" }}>
          <div>Ordered: <strong>{formatDate(order.order_date || order.time_stamps?.order_received)}</strong></div>
          {order.ship_date && (
            <div>Shipped: <strong style={{ color: "#008060" }}>{formatDate(order.ship_date)}</strong></div>
          )}
        </div>
      ),
    },
    {
      header: "Tracking & Documents",
      width: "220px",
      cell: (order) => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {order.tracking ? (
            <a
              href={order.tracking}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "3px 8px",
                backgroundColor: "#e6f4ea",
                color: "#137333",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                textDecoration: "none",
                border: "1px solid #ceead6",
              }}
            >
              <span>🚚</span> Track
            </a>
          ) : (
            <span style={{ fontSize: "11px", color: "#8c9196" }}>No tracking yet</span>
          )}

          {order.invoice && (
            <a
              href={order.invoice}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "3px 8px",
                backgroundColor: "#e8f0fe",
                color: "#1967d2",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                textDecoration: "none",
                border: "1px solid #d2e3fc",
              }}
            >
              <span>📄</span> Invoice
            </a>
          )}

          {order.proof && (
            <a
              href={order.proof}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "3px 8px",
                backgroundColor: "#f1f3f4",
                color: "#3c4043",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                textDecoration: "none",
                border: "1px solid #dadce0",
              }}
            >
              <span>🎨</span> Proof
            </a>
          )}
        </div>
      ),
    },
    {
      header: "Action",
      width: "90px",
      align: "right",
      cell: (order) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedOrder(order);
          }}
          style={{
            padding: "4px 10px",
            backgroundColor: "#f4f6f8",
            border: "1px solid #c9cccf",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            color: "#202223",
          }}
        >
          Details
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", paddingBottom: "48px" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#202223" }}>
            Orders & Production Tracking
          </h1>
          <span style={{ fontSize: "13px", color: "#6d7175" }}>
            Live status, dispatch timestamps, and official courier tracking from the Trends API ({region.toUpperCase()})
          </span>
        </div>

        {/* Region Switcher Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "#6d7175", fontWeight: 500 }}>Region:</span>
          {enabledRegions.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleRegionChange(r)}
              style={{
                padding: "6px 12px",
                borderRadius: "20px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                border: r === region ? "1px solid #008060" : "1px solid #c9cccf",
                backgroundColor: r === region ? "#008060" : "#ffffff",
                color: r === region ? "#ffffff" : "#202223",
                transition: "all 0.15s ease",
              }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Lookup & Search Bar */}
      <form
        onSubmit={handleSearch}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto auto",
          gap: "12px",
          alignItems: "flex-end",
          backgroundColor: "#ffffff",
          padding: "20px",
          borderRadius: "12px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        }}
      >
        <Input
          label="Sales Order Number"
          placeholder="e.g. SO-99214"
          value={salesOrderNum}
          onChange={(e) => setSalesOrderNum(e.target.value)}
          onClear={() => setSalesOrderNum("")}
        />
        <Input
          label="Customer Purchase Order (PO)"
          placeholder="e.g. PO-88124"
          value={poNum}
          onChange={(e) => setPoNum(e.target.value)}
          onClear={() => setPoNum("")}
        />
        <Button type="submit" variant="primary" loading={isLoading}>
          Search Orders
        </Button>
        <Button type="button" variant="outline" onClick={handleClear}>
          Reset
        </Button>
      </form>

      {/* View Toggle Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "13px", color: "#6d7175" }}>
          Showing <strong>{orders.length}</strong> {orders.length === 1 ? "order" : "orders"} for {region.toUpperCase()}
        </div>

        <div style={{ display: "flex", gap: "6px", backgroundColor: "#f1f2f3", padding: "3px", borderRadius: "8px" }}>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            style={{
              padding: "4px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              backgroundColor: viewMode === "table" ? "#ffffff" : "transparent",
              color: viewMode === "table" ? "#202223" : "#6d7175",
              boxShadow: viewMode === "table" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
            }}
          >
            📋 Table View
          </button>
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            style={{
              padding: "4px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              backgroundColor: viewMode === "cards" ? "#ffffff" : "transparent",
              color: viewMode === "cards" ? "#202223" : "#6d7175",
              boxShadow: viewMode === "cards" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
            }}
          >
            📇 Detailed Cards
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          style={{
            padding: "16px 20px",
            backgroundColor: "#fef1f0",
            borderRadius: "12px",
            border: "1px solid #fedcd8",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "20px" }}>⚠️</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#d82c0d" }}>API Connection Error</div>
            <div style={{ fontSize: "12px", color: "#6d7175" }}>{error}</div>
          </div>
        </div>
      )}

      {/* Orders Content */}
      {viewMode === "table" ? (
        <DataTable
          data={orders as (OrderData & Record<string, unknown>)[]}
          columns={columns as ColumnDef<OrderData & Record<string, unknown>>[]}
          loading={isLoading}
          emptyMessage={
            salesOrderNum || poNum
              ? "No orders matched your specific search criteria. Please verify the order number."
              : `No orders found for region ${region.toUpperCase()}.`
          }
          onRowClick={(order) => setSelectedOrder(order as unknown as OrderData)}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {orders.map((order) => (
            <OrderSummaryCard key={order.order_number} order={order} />
          ))}
          {orders.length === 0 && !isLoading && (
            <div
              style={{
                padding: "48px 24px",
                textAlign: "center",
                backgroundColor: "#ffffff",
                borderRadius: "12px",
                border: "1px dashed #c9cccf",
              }}
            >
              <span style={{ fontSize: "32px" }}>📦</span>
              <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginTop: "8px" }}>
                No orders found
              </h3>
              <p style={{ fontSize: "13px", color: "#6d7175" }}>
                {salesOrderNum || poNum
                  ? "No orders matched your specific search criteria. Please verify the order number."
                  : `No orders found for region ${region.toUpperCase()}.`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "24px",
          }}
          onClick={() => setSelectedOrder(null)}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "16px",
              maxWidth: "680px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 24px",
                borderBottom: "1px solid #e1e3e5",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "#202223" }}>
                  Order #{selectedOrder.order_number}
                </h2>
                <StatusBadge
                  label={selectedOrder.status}
                  tone={getStatusTone(selectedOrder.status)}
                  size="sm"
                  dot
                />
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "#6d7175",
                  padding: "4px 8px",
                  borderRadius: "6px",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "24px" }}>
              <OrderSummaryCard order={selectedOrder} />
            </div>

            <div
              style={{
                padding: "16px 24px",
                backgroundColor: "#f9fafb",
                borderTop: "1px solid #e1e3e5",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
