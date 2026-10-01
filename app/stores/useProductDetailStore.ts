import { create } from "zustand";
import type {
  ProductData,
  ProductShowData,
  StockItemData,
  StockListData,
  LeadTimeData,
  LeadTimeListData,
  ApiProxyResponse,
} from "../../shared/types/trends.types";
import { useRegionStore, type StoreStatus } from "./useRegionStore";

interface ProductDetailState {
  // Product Data
  product: ProductData | null;
  productStatus: StoreStatus;
  productError: string | null;

  // Real-time Stock Data
  stock: StockItemData[];
  stockStatus: StoreStatus;
  stockError: string | null;

  // Lead Times
  leadTimes: LeadTimeData[];
  leadTimesStatus: StoreStatus;
  leadTimesError: string | null;

  // Actions
  fetchProduct: (productId: string | number, options?: { bypassCache?: boolean }) => Promise<void>;
  fetchStock: (productId: string | number, options?: { bypassCache?: boolean }) => Promise<void>;
  fetchLeadTimes: (options?: { bypassCache?: boolean }) => Promise<void>;
  loadProductDetailsWithStock: (productId: string | number) => Promise<void>;
  clearProduct: () => void;
}

let productAbortController: AbortController | null = null;
let stockAbortController: AbortController | null = null;

export const useProductDetailStore = create<ProductDetailState>((set, get) => ({
  product: null,
  productStatus: "idle",
  productError: null,

  stock: [],
  stockStatus: "idle",
  stockError: null,

  leadTimes: [],
  leadTimesStatus: "idle",
  leadTimesError: null,

  fetchProduct: async (productId: string | number, options = {}) => {
    if (productAbortController) {
      productAbortController.abort();
    }
    productAbortController = new AbortController();

    const region = useRegionStore.getState().currentRegion;
    set({ productStatus: "loading", productError: null });

    try {
      const url = `/api/proxy/${region}/products/${productId}${
        options.bypassCache ? "?bypassCache=true" : ""
      }`;

      const res = await fetch(url, {
        signal: productAbortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch product ${productId} (HTTP ${res.status})`);
      }

      const envelope = (await res.json()) as ApiProxyResponse<ProductShowData>;
      const product = envelope.data?.data || null;

      set({
        product,
        productStatus: "success",
        productError: null,
      });
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      set({
        productStatus: "error",
        productError: (err as Error)?.message || "Failed to load product details",
      });
    } finally {
      productAbortController = null;
    }
  },

  fetchStock: async (productId: string | number, options = {}) => {
    if (stockAbortController) {
      stockAbortController.abort();
    }
    stockAbortController = new AbortController();

    const region = useRegionStore.getState().currentRegion;
    set({ stockStatus: "loading", stockError: null });

    try {
      const url = `/api/proxy/${region}/stock/${productId}${
        options.bypassCache ? "?bypassCache=true" : ""
      }`;

      const res = await fetch(url, {
        signal: stockAbortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch stock for ${productId} (HTTP ${res.status})`);
      }

      const envelope = (await res.json()) as ApiProxyResponse<StockListData>;
      const stock = envelope.data?.data || [];

      set({
        stock,
        stockStatus: "success",
        stockError: null,
      });
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      set({
        stockStatus: "error",
        stockError: (err as Error)?.message || "Failed to load live stock",
      });
    } finally {
      stockAbortController = null;
    }
  },

  fetchLeadTimes: async (options = {}) => {
    const region = useRegionStore.getState().currentRegion;
    set({ leadTimesStatus: "loading", leadTimesError: null });

    try {
      const url = `/api/proxy/${region}/lead-times${
        options.bypassCache ? "?bypassCache=true" : ""
      }`;

      const res = await fetch(url);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch lead times (HTTP ${res.status})`);
      }

      const envelope = (await res.json()) as ApiProxyResponse<LeadTimeListData>;
      const processes = envelope.data?.processes || [];

      set({
        leadTimes: processes,
        leadTimesStatus: "success",
        leadTimesError: null,
      });
    } catch (err: unknown) {
      set({
        leadTimesStatus: "error",
        leadTimesError: (err as Error)?.message || "Failed to load lead times",
      });
    }
  },

  loadProductDetailsWithStock: async (productId: string | number) => {
    await Promise.allSettled([
      get().fetchProduct(productId),
      get().fetchStock(productId),
      get().fetchLeadTimes(),
    ]);
  },

  clearProduct: () => {
    set({
      product: null,
      productStatus: "idle",
      productError: null,
      stock: [],
      stockStatus: "idle",
      stockError: null,
      leadTimes: [],
      leadTimesStatus: "idle",
      leadTimesError: null,
    });
  },
}));
