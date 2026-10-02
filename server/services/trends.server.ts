import { TrendsApiClient } from "../api-client/trends-client";
import { getAppSettings } from "../settings/app-settings.service";
import type { Region, OrderData, OrderListData } from "../../shared/types/trends.types";

export interface GetOrdersOptions {
  region: Region;
  shop?: string;
  ponum?: string;
  salesordernum?: string;
}

/**
 * Server-side service to query the Trends API Orders endpoint:
 * GET /api/v1/orders.{format}
 *
 * Supports filtering by purchase order number (`ponum`) and/or Trends sales order number (`salesordernum`).
 * Conforms strictly to the official Trends OpenAPI 3.1.0 specification.
 */
export async function getOrders(options: GetOrdersOptions): Promise<OrderData[]> {
  const { region, shop = "demo.myshopify.com", ponum, salesordernum } = options;

  // Resolve DB-backed settings (API keys & active region constraints)
  const appSettings = await getAppSettings(shop);

  const queryParams: Record<string, string> = {};
  if (ponum && ponum.trim()) {
    queryParams.ponum = ponum.trim();
  }
  if (salesordernum && salesordernum.trim()) {
    queryParams.salesordernum = salesordernum.trim();
  }

  const response = await TrendsApiClient.request<OrderListData>(region, "orders", {
    method: "GET",
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    settings: appSettings,
  });

  const orderList = response?.data?.data;
  return Array.isArray(orderList) ? orderList : [];
}

/**
 * Server-side service to look up a single order by Sales Order Number or PO Number.
 */
export async function getOrderByNumber(
  region: Region,
  orderNumber: string,
  shop?: string
): Promise<OrderData | null> {
  const isPo = orderNumber.toUpperCase().startsWith("PO-");
  const orders = await getOrders({
    region,
    shop,
    ponum: isPo ? orderNumber : undefined,
    salesordernum: !isPo ? orderNumber : undefined,
  });

  return (
    orders.find(
      (o) =>
        o.order_number?.toLowerCase() === orderNumber.toLowerCase() ||
        o.purchase_order_number?.toLowerCase() === orderNumber.toLowerCase()
    ) || null
  );
}
