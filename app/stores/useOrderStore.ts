import { create } from "zustand";
import type {
  OrderData,
  OrderListData,
  ListOrdersQuery,
  ApiProxyResponse,
} from "../../shared/types/trends.types";
import { useRegionStore, type StoreStatus } from "./useRegionStore";

interface OrderState {
  orders: OrderData[];
  ordersStatus: StoreStatus;
  ordersError: string | null;

  activeOrder: OrderData | null;

  // Actions
  fetchOrders: (query?: ListOrdersQuery) => Promise<void>;
  setActiveOrder: (order: OrderData | null) => void;
  resetOrderState: () => void;
}

export const useOrderStore = create<OrderState>((set) => ({
  orders: [],
  ordersStatus: "idle",
  ordersError: null,

  activeOrder: null,

  fetchOrders: async (query = {}) => {
    const region = useRegionStore.getState().currentRegion;
    set({ ordersStatus: "loading", ordersError: null });

    try {
      const queryParams = new URLSearchParams();
      if (query.salesordernum) {
        queryParams.set("salesordernum", query.salesordernum);
      }
      if (query.ponum) {
        queryParams.set("ponum", query.ponum);
      }

      const qs = queryParams.toString();
      const url = `/api/proxy/${region}/orders${qs ? `?${qs}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch orders (HTTP ${res.status})`);
      }

      const envelope = (await res.json()) as ApiProxyResponse<OrderListData>;
      const orderList = envelope.data?.data || [];

      set({
        orders: orderList,
        ordersStatus: "success",
        ordersError: null,
      });
    } catch (err: unknown) {
      set({
        ordersStatus: "error",
        ordersError: (err as Error)?.message || "Failed to load orders",
      });
    }
  },

  setActiveOrder: (order: OrderData | null) => {
    set({ activeOrder: order });
  },

  resetOrderState: () => {
    set({
      orders: [],
      ordersStatus: "idle",
      ordersError: null,
      activeOrder: null,
    });
  },
}));
