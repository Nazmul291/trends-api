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

  // Shopify Sync State
  syncStatus: StoreStatus;
  syncError: string | null;
  syncJobId: string | null;
  syncStage: string | null;
  syncProgress: number;
  syncMessage: string | null;
  syncResult: {
    action: "created" | "updated";
    shopifyProductId: string;
    shopifyHandle?: string;
    skuList: string[];
    message: string;
    isMock?: boolean;
  } | null;

  // Bi-directional Sync Tracking & Lifecycle
  isSynced: boolean;
  shopifyProductId: string | null;
  shopifyNumericId: string | null;
  shopifyShop: string | null;
  deleteStatus: StoreStatus;
  deleteError: string | null;

  // Actions
  fetchProduct: (productId: string | number, options?: { bypassCache?: boolean }) => Promise<void>;
  fetchStock: (productId: string | number, options?: { bypassCache?: boolean }) => Promise<void>;
  fetchLeadTimes: (options?: { bypassCache?: boolean }) => Promise<void>;
  loadProductDetailsWithStock: (productId: string | number) => Promise<void>;
  checkSyncStatus: (productId: string | number) => Promise<void>;
  syncProductToShopify: (
    productOverride?: ProductData,
    locationOptions?: {
      inventorySyncMode?: "single" | "split_equal";
      targetLocationId?: string | null;
      splitLocationIds?: string[];
    }
  ) => Promise<boolean>;
  deleteProductFromShopify: () => Promise<boolean>;
  clearProduct: () => void;
}

let productAbortController: AbortController | null = null;
let stockAbortController: AbortController | null = null;
let syncPollInterval: ReturnType<typeof setInterval> | null = null;
let pollStartTime: number = 0;

export function stopSyncPolling() {
  if (syncPollInterval) {
    clearInterval(syncPollInterval);
    syncPollInterval = null;
  }
}

export function startSyncPolling(jobId: string, productId: string | number, region: string) {
  stopSyncPolling();
  pollStartTime = Date.now();

  const poll = async () => {
    // 2-minute safe timeout threshold: Prevent permanent loading states
    if (Date.now() - pollStartTime > 120_000) {
      stopSyncPolling();
      useProductDetailStore.setState({
        syncStatus: "error",
        syncStage: "FAILED",
        syncProgress: 0,
        syncError: "Sync execution timed out after 2 minutes. Please retry.",
        syncMessage: null,
      });
      return;
    }

    try {
      const res = await fetch(
        `/api/proxy/${region}/sync-status?jobId=${encodeURIComponent(jobId)}&productId=${encodeURIComponent(
          productId
        )}`
      );
      if (!res.ok) return;

      const data = await res.json();
      const status = data.status;
      const stage = data.stage;
      const progress = data.progress ?? 0;
      const message = data.message || "";
      const result = data.result || data.job?.result || null;
      const errorMessage = data.errorMessage || data.job?.errorMessage || null;

      if (status === "COMPLETED") {
        stopSyncPolling();
        const shopifyProductId =
          result?.shopifyProductId || data.data?.[String(productId)]?.shopifyProductId || null;
        const shopifyNumericId = shopifyProductId ? shopifyProductId.split("/").pop() : null;

        useProductDetailStore.setState({
          syncStatus: "success",
          syncStage: "COMPLETED",
          syncProgress: 100,
          syncMessage: message || "Product sync completed successfully.",
          syncError: null,
          syncResult: result,
          isSynced: true,
          shopifyProductId,
          shopifyNumericId,
        });
      } else if (status === "FAILED") {
        stopSyncPolling();
        useProductDetailStore.setState({
          syncStatus: "error",
          syncStage: "FAILED",
          syncProgress: 0,
          syncError: errorMessage || message || "Product synchronization failed.",
          syncMessage: null,
        });
      } else {
        // IN_PROGRESS or QUEUED
        useProductDetailStore.setState({
          syncStatus: "loading",
          syncStage: stage || "IN_PROGRESS",
          syncProgress: Math.max(10, progress),
          syncMessage: message || "Sync in progress...",
        });
      }
    } catch (pollErr) {
      console.warn("[useProductDetailStore] Sync polling transient error:", pollErr);
    }
  };

  poll();
  syncPollInterval = setInterval(poll, 2000);
}

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

  syncStatus: "idle",
  syncError: null,
  syncJobId: null,
  syncStage: null,
  syncProgress: 0,
  syncMessage: null,
  syncResult: null,

  isSynced: false,
  shopifyProductId: null,
  shopifyNumericId: null,
  shopifyShop: null,
  deleteStatus: "idle",
  deleteError: null,

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
      const rawData = envelope.data?.data;
      const product = Array.isArray(rawData) ? rawData[0] || null : rawData || null;

      if (product?.stock && Array.isArray(product.stock) && product.stock.length > 0) {
        set({ stock: product.stock, stockStatus: "success", stockError: null });
      }

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
      const rawStock = envelope.data?.data;
      const stock = Array.isArray(rawStock) ? rawStock : [];

      set((state) => ({
        stock,
        stockStatus: "success",
        stockError: null,
        product: state.product ? { ...state.product, stock } : state.product,
      }));
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
      get().checkSyncStatus(productId),
    ]);
  },

  checkSyncStatus: async (productId: string | number) => {
    const region = useRegionStore.getState().currentRegion;
    try {
      const res = await fetch(`/api/proxy/${region}/sync-status?productId=${productId}`);
      if (!res.ok) return;
      const json = await res.json();
      const statusData = json.data?.[String(productId)];

      // Check if an active background sync job is currently running
      if (json.jobId && (json.status === "IN_PROGRESS" || json.status === "QUEUED")) {
        set({
          syncStatus: "loading",
          syncJobId: json.jobId,
          syncStage: json.stage,
          syncProgress: json.progress || 15,
          syncMessage: json.message,
          shopifyShop: json.shop || null,
        });
        startSyncPolling(json.jobId, productId, region);
        return;
      }

      if (statusData && statusData.isSynced) {
        set({
          isSynced: true,
          shopifyProductId: statusData.shopifyProductId,
          shopifyNumericId: statusData.shopifyNumericId || statusData.shopifyProductId?.split("/").pop() || null,
          shopifyShop: json.shop || null,
        });
      } else {
        set({
          isSynced: false,
          shopifyProductId: null,
          shopifyNumericId: null,
          shopifyShop: json.shop || null,
        });
      }
    } catch {
      // Non-blocking sync check
    }
  },

  syncProductToShopify: async (
    productOverride?: ProductData,
    locationOptions?: {
      inventorySyncMode?: "single" | "split_equal";
      targetLocationId?: string | null;
      splitLocationIds?: string[];
    }
  ) => {
    const targetProduct = productOverride || get().product;
    if (!targetProduct) {
      set({
        syncStatus: "error",
        syncError: "No product selected to sync to Shopify",
      });
      return false;
    }

    const region = useRegionStore.getState().currentRegion;
    set({
      syncStatus: "loading",
      syncError: null,
      syncStage: "QUEUED",
      syncProgress: 5,
      syncMessage: "Initiating background sync job...",
    });

    try {
      const res = await fetch(`/api/proxy/${region}/sync-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: targetProduct.code,
          product: targetProduct,
          region,
          ...(locationOptions?.inventorySyncMode
            ? { inventorySyncMode: locationOptions.inventorySyncMode }
            : {}),
          ...(locationOptions?.targetLocationId !== undefined
            ? { targetLocationId: locationOptions.targetLocationId }
            : {}),
          ...(locationOptions?.splitLocationIds !== undefined
            ? { splitLocationIds: locationOptions.splitLocationIds }
            : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Sync initiation failed with HTTP ${res.status}`);
      }

      const jobId = data.jobId;
      set({
        syncJobId: jobId,
        syncStage: data.stage || "QUEUED",
        syncProgress: data.progress || 10,
        syncMessage: data.message || "Sync queued in background...",
      });

      if (jobId) {
        startSyncPolling(jobId, targetProduct.code, region);
      }

      return true;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || "Failed to sync product to Shopify";
      set({
        syncStatus: "error",
        syncError: msg,
        syncProgress: 0,
      });
      return false;
    }
  },

  deleteProductFromShopify: async () => {
    const targetProduct = get().product;
    if (!targetProduct) {
      set({
        deleteStatus: "error",
        deleteError: "No product selected to delete",
      });
      return false;
    }

    const region = useRegionStore.getState().currentRegion;
    set({ deleteStatus: "loading", deleteError: null });

    try {
      const res = await fetch(`/api/proxy/${region}/delete-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: targetProduct.code,
          trendsCode: targetProduct.code,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Deletion failed with HTTP ${res.status}`);
      }

      set({
        deleteStatus: "success",
        deleteError: null,
        isSynced: false,
        shopifyProductId: null,
        shopifyNumericId: null,
        syncStatus: "idle",
        syncResult: null,
      });
      return true;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || "Failed to delete product from Shopify";
      set({
        deleteStatus: "error",
        deleteError: msg,
      });
      return false;
    }
  },

  clearProduct: () => {
    stopSyncPolling();
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
      syncStatus: "idle",
      syncError: null,
      syncJobId: null,
      syncStage: null,
      syncProgress: 0,
      syncMessage: null,
      syncResult: null,
      isSynced: false,
      shopifyProductId: null,
      shopifyNumericId: null,
      deleteStatus: "idle",
      deleteError: null,
    });
  },
}));
