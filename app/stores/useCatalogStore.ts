import { create } from "zustand";
import type {
  CategoryData,
  CategoryListData,
  ProductData,
  ProductListData,
  Region,
  ApiProxyResponse,
} from "../../shared/types/trends.types";
import { useRegionStore, type StoreStatus } from "./useRegionStore";

interface PaginationMeta {
  pageCurrent: number;
  pageCount: number;
  pageSize: number;
  totalItems: number;
}

interface CatalogFilters {
  categoryNo: number | string | null;
  incDiscontinued: boolean;
  searchQuery: string;
}

interface CatalogState {
  // Categories state
  categories: CategoryData[];
  categoriesStatus: StoreStatus;
  categoriesError: string | null;

  // Products state
  products: ProductData[];
  pagination: PaginationMeta;
  filters: CatalogFilters;
  productsStatus: StoreStatus;
  productsError: string | null;

  // Sync state
  syncingProductId: string | null;
  deletingProductId: string | null;
  syncedProductMap: Record<string, { shopifyProductId: string; shopifyNumericId?: string; isSynced: boolean }>;

  // Actions
  fetchCategories: (options?: { incDiscontinued?: boolean; bypassCache?: boolean }) => Promise<void>;
  fetchProducts: (options?: {
    categoryNo?: number | string | null;
    pageNo?: number;
    search?: string;
    bypassCache?: boolean;
  }) => Promise<void>;
  fetchSyncStatuses: (codes?: string[]) => Promise<void>;
  syncProductToShopify: (product: ProductData) => Promise<{ success: boolean; data?: any; error?: string }>;
  deleteProductFromShopify: (product: ProductData) => Promise<{ success: boolean; error?: string }>;
  setSelectedCategory: (categoryId: number | string | null) => void;
  setSearchQuery: (query: string) => void;
  setPage: (pageNo: number) => void;
  resetFilters: () => void;
  resetCatalog: () => void;
}

const DEFAULT_PAGINATION: PaginationMeta = {
  pageCurrent: 1,
  pageCount: 1,
  pageSize: 24,
  totalItems: 0,
};

const DEFAULT_FILTERS: CatalogFilters = {
  categoryNo: null,
  incDiscontinued: false,
  searchQuery: "",
};

let activeProductsAbortController: AbortController | null = null;
let activeCategoriesAbortController: AbortController | null = null;

export const useCatalogStore = create<CatalogState>((set, get) => ({
  categories: [],
  categoriesStatus: "idle",
  categoriesError: null,

  products: [],
  pagination: DEFAULT_PAGINATION,
  filters: DEFAULT_FILTERS,
  productsStatus: "idle",
  productsError: null,
  syncingProductId: null,
  deletingProductId: null,
  syncedProductMap: {},

  fetchCategories: async (options = {}) => {
    if (activeCategoriesAbortController) {
      activeCategoriesAbortController.abort();
    }
    activeCategoriesAbortController = new AbortController();

    const region = useRegionStore.getState().currentRegion;
    const incDiscontinued = options.incDiscontinued ?? get().filters.incDiscontinued;

    set({ categoriesStatus: "loading", categoriesError: null });

    try {
      const queryParams = new URLSearchParams({
        inc_discontinued: String(incDiscontinued),
      });

      if (options.bypassCache) {
        queryParams.set("bypassCache", "true");
      }

      const res = await fetch(`/api/proxy/${region}/categories?${queryParams.toString()}`, {
        signal: activeCategoriesAbortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch categories (HTTP ${res.status})`);
      }

      const envelope = (await res.json()) as ApiProxyResponse<CategoryListData>;
      const categoryList = envelope.data?.data || [];

      set({
        categories: categoryList,
        categoriesStatus: "success",
        categoriesError: null,
      });
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      set({
        categoriesStatus: "error",
        categoriesError: (err as Error)?.message || "Error loading categories",
      });
    } finally {
      activeCategoriesAbortController = null;
    }
  },

  fetchProducts: async (options = {}) => {
    if (activeProductsAbortController) {
      activeProductsAbortController.abort();
    }
    activeProductsAbortController = new AbortController();

    const region = useRegionStore.getState().currentRegion;
    const categoryNo = options.categoryNo !== undefined ? options.categoryNo : get().filters.categoryNo;
    const pageNo = options.pageNo !== undefined ? options.pageNo : get().pagination.pageCurrent;
    const searchQuery = options.search !== undefined ? options.search : get().filters.searchQuery;

    set({
      productsStatus: "loading",
      productsError: null,
      filters: {
        ...get().filters,
        categoryNo,
        searchQuery,
      },
    });

    try {
      const queryParams = new URLSearchParams({
        page_no: String(pageNo),
      });

      if (categoryNo !== null && categoryNo !== undefined && categoryNo !== "") {
        queryParams.set("category_no", String(categoryNo));
      }

      if (options.bypassCache) {
        queryParams.set("bypassCache", "true");
      }

      const res = await fetch(`/api/proxy/${region}/products?${queryParams.toString()}`, {
        signal: activeProductsAbortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch products (HTTP ${res.status})`);
      }

      const envelope = (await res.json()) as ApiProxyResponse<ProductListData>;
      const listData = envelope.data;

      // Filter locally if searchQuery is provided
      let items = listData?.data || [];
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        items = items.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q)
        );
      }

      set({
        products: items,
        pagination: {
          pageCurrent: listData?.page_current || 1,
          pageCount: listData?.page_count || 1,
          pageSize: listData?.page_size || 24,
          totalItems: listData?.total_items || items.length,
        },
        productsStatus: "success",
        productsError: null,
      });

      // Automatically fetch sync status for returned products
      if (items.length > 0) {
        get().fetchSyncStatuses(items.map((p) => p.code));
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      set({
        productsStatus: "error",
        productsError: (err as Error)?.message || "Error loading products",
      });
    } finally {
      activeProductsAbortController = null;
    }
  },

  fetchSyncStatuses: async (codes = []) => {
    const region = useRegionStore.getState().currentRegion;
    try {
      const url = codes.length > 0
        ? `/api/proxy/${region}/sync-status?codes=${codes.join(",")}`
        : `/api/proxy/${region}/sync-status`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data) {
        set((state) => ({
          syncedProductMap: {
            ...state.syncedProductMap,
            ...json.data,
          },
        }));
      }
    } catch {
      // Non-blocking status lookup
    }
  },

  setSelectedCategory: (categoryId: number | string | null) => {
    set((state) => ({
      filters: { ...state.filters, categoryNo: categoryId },
      pagination: { ...state.pagination, pageCurrent: 1 },
    }));
    get().fetchProducts({ categoryNo: categoryId, pageNo: 1 });
  },

  setSearchQuery: (query: string) => {
    set((state) => ({
      filters: { ...state.filters, searchQuery: query },
    }));
  },

  setPage: (pageNo: number) => {
    get().fetchProducts({ pageNo });
  },

  syncProductToShopify: async (product: ProductData) => {
    const region = useRegionStore.getState().currentRegion;
    set({ syncingProductId: product.code });

    try {
      const res = await fetch(`/api/proxy/${region}/sync-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.code,
          product,
          region,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Sync failed with HTTP ${res.status}`);
      }

      const shopifyProductId = data.data?.shopifyProductId || null;
      const numericId = shopifyProductId ? shopifyProductId.split("/").pop() : undefined;

      set((state) => ({
        syncingProductId: null,
        syncedProductMap: {
          ...state.syncedProductMap,
          [product.code]: {
            shopifyProductId,
            shopifyNumericId: numericId,
            isSynced: true,
          },
        },
      }));
      return { success: true, data: data.data };
    } catch (err: unknown) {
      set({ syncingProductId: null });
      return {
        success: false,
        error: (err as Error)?.message || "Failed to sync product to Shopify",
      };
    }
  },

  deleteProductFromShopify: async (product: ProductData) => {
    const region = useRegionStore.getState().currentRegion;
    set({ deletingProductId: product.code });

    try {
      const res = await fetch(`/api/proxy/${region}/delete-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.code,
          trendsCode: product.code,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Deletion failed with HTTP ${res.status}`);
      }

      set((state) => {
        const updated = { ...state.syncedProductMap };
        delete updated[product.code];
        return {
          deletingProductId: null,
          syncedProductMap: updated,
        };
      });
      return { success: true };
    } catch (err: unknown) {
      set({ deletingProductId: null });
      return {
        success: false,
        error: (err as Error)?.message || "Failed to delete product from Shopify",
      };
    }
  },

  resetFilters: () => {
    set({ filters: DEFAULT_FILTERS });
    get().fetchProducts({ categoryNo: undefined, pageNo: 1, search: "" });
  },

  resetCatalog: () => {
    set({
      categories: [],
      categoriesStatus: "idle",
      categoriesError: null,
      products: [],
      pagination: DEFAULT_PAGINATION,
      filters: DEFAULT_FILTERS,
      productsStatus: "idle",
      productsError: null,
      syncingProductId: null,
      deletingProductId: null,
      syncedProductMap: {},
    });
  },
}));
