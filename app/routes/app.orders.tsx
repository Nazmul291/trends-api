import React, { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { useOrderStore } from "../stores/useOrderStore";
import { useRegionStore } from "../stores/useRegionStore";
import { OrderSummaryCard } from "../components/organisms/OrderSummaryCard";
import { Input } from "../components/atoms/Input";
import { Button } from "../components/atoms/Button";
import { Skeleton } from "../components/atoms/Skeleton";
import { StatusBadge } from "../components/atoms/StatusBadge";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function OrdersPage() {
  const currentRegion = useRegionStore((s) => s.currentRegion);

  const orders = useOrderStore((s) => s.orders);
  const status = useOrderStore((s) => s.ordersStatus);
  const error = useOrderStore((s) => s.ordersError);
  const fetchOrders = useOrderStore((s) => s.fetchOrders);
  const resetOrderState = useOrderStore((s) => s.resetOrderState);

  const [salesOrderNum, setSalesOrderNum] = useState("");
  const [poNum, setPoNum] = useState("");

  useEffect(() => {
    // Initial fetch of recent orders for the active region
    fetchOrders();
  }, [currentRegion, fetchOrders]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOrders({
      salesordernum: salesOrderNum.trim() || undefined,
      ponum: poNum.trim() || undefined,
    });
  };

  const handleClear = () => {
    setSalesOrderNum("");
    setPoNum("");
    fetchOrders();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#202223" }}>
            Orders & Production Tracking
          </h1>
          <span style={{ fontSize: "13px", color: "#6d7175" }}>
            Live status, dispatch timestamps, and invoice tracking for {currentRegion.toUpperCase()}
          </span>
        </div>
        <StatusBadge label={`Active Region: ${currentRegion.toUpperCase()}`} tone="info" />
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
          placeholder="e.g. SO-109283"
          value={salesOrderNum}
          onChange={(e) => setSalesOrderNum(e.target.value)}
          onClear={() => setSalesOrderNum("")}
        />
        <Input
          label="Customer Purchase Order (PO)"
          placeholder="e.g. PO-88912"
          value={poNum}
          onChange={(e) => setPoNum(e.target.value)}
          onClear={() => setPoNum("")}
        />
        <Button type="submit" variant="primary" loading={status === "loading"}>
          Search Orders
        </Button>
        <Button type="button" variant="outline" onClick={handleClear}>
          Reset
        </Button>
      </form>

      {/* Orders Listing Content */}
      {status === "loading" && orders.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                backgroundColor: "#ffffff",
                padding: "20px",
                borderRadius: "12px",
                border: "1px solid #e1e3e5",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <Skeleton width="40%" height="24px" />
              <Skeleton width="60%" height="16px" />
              <Skeleton height="60px" borderRadius="8px" />
            </div>
          ))}
        </div>
      ) : status === "error" ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            backgroundColor: "#fef1f0",
            borderRadius: "12px",
            border: "1px solid #fedcd8",
          }}
        >
          <span style={{ fontSize: "28px" }}>⚠️</span>
          <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#d82c0d", marginTop: "8px" }}>
            Failed to retrieve orders
          </h3>
          <p style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>{error}</p>
          <Button variant="outline" onClick={() => fetchOrders()}>
            Try Again
          </Button>
        </div>
      ) : orders.length === 0 ? (
        <div
          style={{
            padding: "64px 24px",
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
          <p style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>
            {salesOrderNum || poNum
              ? "No orders matched your specific search criteria. Please verify the order number."
              : `No recent orders found for region ${currentRegion.toUpperCase()}.`}
          </p>
          {(salesOrderNum || poNum) && (
            <Button variant="outline" onClick={handleClear}>
              Clear Search Query
            </Button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {orders.map((order) => (
            <OrderSummaryCard key={order.order_number} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}
