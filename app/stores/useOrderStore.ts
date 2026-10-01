import { create } from "zustand";
import type {
  OrderData,
  OrderListData,
  ListOrdersQuery,
  CreateOrderPayload,
  ApiProxyResponse,
} from "../../shared/types/trends.types";
import { useRegionStore, type StoreStatus } from "./useRegionStore";

interface OrderState {
  orders: OrderData[];
  ordersStatus: StoreStatus;
  ordersError: string | null;

  activeOrder: OrderData | null;
  submitStatus: StoreStatus;
  submitError: string | null;

  // Actions
  fetchOrders: (query?: ListOrdersQuery) => Promise<void>;
  createOrder: (payload: CreateOrderPayload) => Promise<OrderData | null>;
  setActiveOrder: (order: OrderData | null) => void;
  resetOrderState: () => void;
}

export const useOrderStore = create<OrderState>((set) => ({
  orders: [],
  ordersStatus: "idle",
  ordersError: null,

  activeOrder: null,
  submitStatus: "idle",
  submitError: null,

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

  createOrder: async (payload: CreateOrderPayload): Promise<OrderData | null> => {
    const region = useRegionStore.getState().currentRegion;
    set({ submitStatus: "loading", submitError: null });

    try {
      const res = await fetch(`/api/proxy/${region}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to place order (HTTP ${res.status})`);
      }

      const envelope = (await res.json()) as ApiProxyResponse<OrderData>;
      const createdOrder = envelope.data;

      set((state) => ({
        orders: createdOrder ? [createdOrder, ...state.orders] : state.orders,
        activeOrder: createdOrder || null,
        submitStatus: "success",
        submitError: null,
      }));

      return createdOrder || null;
    } catch (err: unknown) {
      set({
        submitStatus: "error",
        submitError: (err as Error)?.message || "Order submission failed",
      });
      return null;
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
      submitStatus: "idle",
      submitError: null,
    });
  },
}));
