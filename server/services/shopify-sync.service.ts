import { randomUUID } from "node:crypto";
import type { ProductData, Region, StockListData } from "../../shared/types/trends.types";
import { normalizePricing } from "../../shared/types/trends.types";
import { TrendsApiClient } from "../api-client/trends-client";
import { getAppSettings } from "../settings/app-settings.service";
import prisma from "../../app/db.server";

export interface SyncTrendProductOptions {
  admin?: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
  shop: string;
  trendsProduct: ProductData;
  region: Region;
  syncLocks?: string[];
  isMock?: boolean;
  inventorySyncMode?: "single" | "split_equal";
  targetLocationId?: string | null;
  splitLocationIds?: string[];
}

export interface SyncTrendProductResult {
  success: boolean;
  action: "created" | "updated";
  shopifyProductId: string;
  shopifyHandle?: string;
  skuList: string[];
  message: string;
  isMock?: boolean;
}

export interface DeleteTrendProductOptions {
  admin?: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
  shop: string;
  trendsCode: string;
}

export interface DeleteTrendProductResult {
  success: boolean;
  trendsCode: string;
  shopifyProductId?: string;
  message: string;
}

export interface SyncStatusItem {
  isSynced: boolean;
  shopifyProductId: string | null;
  shopifyNumericId?: string;
  shopifyHandle?: string;
  lastSyncedAt?: string;
  region?: string;
  variantCount?: number;
}

/**
 * Builds clean HTML description preserving features and dimensions
 */
function buildDescriptionHtml(product: ProductData): string {
  const parts: string[] = [];

  if (product.description) {
    parts.push(`<p>${product.description}</p>`);
  }

  if (product.features && product.features.length > 0) {
    parts.push("<h3>Product Features</h3>");
    parts.push("<ul>");
    for (const f of product.features) {
      parts.push(`<li>${f}</li>`);
    }
    parts.push("</ul>");
  }

  if (product.dimensions) {
    parts.push(`<p><strong>Dimensions:</strong> ${product.dimensions}</p>`);
  }

  if (product.packaging) {
    parts.push(`<p><strong>Packaging:</strong> ${product.packaging}</p>`);
  }

  return parts.join("\n");
}

/**
 * Extracts base wholesale price formatted to 2 decimal places in regional currency.
 */
export function extractBasePrice(product: ProductData, region: Region): string {
  const pricingList = normalizePricing(product.pricing);
  if (pricingList.length > 0) {
    for (const group of pricingList) {
      if (group.prices && group.prices.length > 0) {
        for (const p of group.prices) {
          const raw = p.price;
          if (raw !== undefined && raw !== null && raw !== "") {
            const parsed = typeof raw === "number" ? raw : parseFloat(String(raw));
            if (!isNaN(parsed) && parsed > 0) {
              return parsed.toFixed(2);
            }
          }
        }
      }
    }
  }

  // Regional baseline fallback
  const regionalDefaults: Record<Region, number> = {
    nz: 16.50,
    au: 15.20,
    sg: 14.00,
  };
  return (regionalDefaults[region] || 15.00).toFixed(2);
}

/**
 * Sanitizes image URL ensuring an absolute https protocol
 */
export function sanitizeImageUrl(link: string | undefined): string | null {
  if (!link || typeof link !== "string") return null;
  const trimmed = link.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `https://assets.trends.nz${trimmed}`;
  }
  return `https://${trimmed}`;
}

export interface VariantSpec {
  stockCode: string;
  optionValue: string;
  quantity: number;
  canonicalSku: string;
}

export interface ExtractedStockItem {
  stockCode: string;
  quantity: number;
  description: string;
  nextShipment?: number;
  dueDate?: string | null;
  raw?: unknown;
}

/**
 * Defensive parser that extracts normalized variant stock counts from Trends API stock payloads.
 * Handles single objects, array responses, nested data envelopes, and alternate field names
 * (e.g. quantity, available, available_stock, stock, qty).
 */
export function parseTrendsStockResponse(responsePayload: unknown): ExtractedStockItem[] {
  if (!responsePayload) return [];

  let items: any[] = [];
  const payload = (responsePayload as any)?.data ?? responsePayload;

  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === "object") {
    if (Array.isArray(payload.data)) {
      items = payload.data;
    } else if (Array.isArray(payload.stock)) {
      items = payload.stock;
    } else if (Array.isArray(payload.items)) {
      items = payload.items;
    } else if (Array.isArray(payload.variants)) {
      items = payload.variants;
    } else if (payload.stock_code || payload.code || payload.sku || payload.item_code) {
      items = [payload];
    }
  }

  return items.map((item, idx) => {
    const stockCode = String(
      item.stock_code ??
      item.stockCode ??
      item.code ??
      item.sku ??
      item.item_code ??
      item.id ??
      `STK-${idx + 1}`
    ).trim();

    // Check all variant-level stock field conventions
    const rawQty =
      item.quantity ??
      item.available ??
      item.available_stock ??
      item.availableStock ??
      item.stock ??
      item.qty ??
      item.stock_quantity ??
      item.stockQuantity ??
      item.variant?.stock ??
      item.variant?.quantity ??
      item.variant?.available;

    let parsedQty = 0;
    if (typeof rawQty === "number") {
      parsedQty = Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : 0;
    } else if (typeof rawQty === "string") {
      const cleaned = rawQty.replace(/[^0-9.-]/g, "");
      const num = parseInt(cleaned, 10);
      parsedQty = !isNaN(num) ? Math.max(0, num) : 0;
    }

    const description = String(
      item.description || item.name || item.colour || item.color || item.style || ""
    ).trim();

    return {
      stockCode,
      quantity: parsedQty,
      description,
      nextShipment: typeof item.next_shipment === "number" ? item.next_shipment : undefined,
      dueDate: item.due_date || null,
      raw: item,
    };
  });
}

/**
 * Builds normalized variant specification matrix from stock or colours.
 */
export function buildVariantSpecs(
  product: ProductData,
  region: Region,
  trendsCode: string
): { optionName: string; specs: VariantSpec[] } {
  const normalizedRegion = region.toLowerCase() as Region;
  const rawColours = product.colours as unknown;
  const colours: string[] = Array.isArray(rawColours)
    ? rawColours
    : typeof rawColours === "string" && rawColours.length > 0
    ? (rawColours as string).split(",").map((c: string) => c.trim()).filter(Boolean)
    : [];
  const hasColours = colours.length > 0;
  const optionName = hasColours ? "Color" : "Style";

  let rawList: { stockCode: string; description: string; quantity: number }[] = [];

  if (product.stock && product.stock.length > 0) {
    const parsedStock = parseTrendsStockResponse(product.stock);
    if (parsedStock.length > 0) {
      rawList = parsedStock.map((s, idx) => ({
        stockCode: s.stockCode || `STK-${idx + 1}`,
        description: s.description || colours[idx] || `Style ${idx + 1}`,
        quantity: s.quantity,
      }));
    }
  }

  if (rawList.length === 0) {
    if (hasColours) {
      rawList = colours.map((col, idx) => ({
        stockCode: `COL-${idx + 1}`,
        description: col,
        quantity: 0,
      }));
    } else {
      rawList = [
        {
          stockCode: "DEFAULT",
          description: "Standard",
          quantity: 0,
        },
      ];
    }
  }

  // Ensure unique option values (Shopify enforces uniqueness within an option)
  const seenValues = new Set<string>();
  const specs: VariantSpec[] = rawList.map((item, idx) => {
    let optVal = item.description.trim() || item.stockCode || `Variant ${idx + 1}`;
    if (seenValues.has(optVal)) {
      optVal = `${optVal} (${item.stockCode})`;
    }
    seenValues.add(optVal);

    return {
      stockCode: item.stockCode,
      optionValue: optVal,
      quantity: item.quantity,
      canonicalSku: `TR-${normalizedRegion.toUpperCase()}-${trendsCode}-${item.stockCode}`,
    };
  });

  return { optionName, specs };
}

export interface LocationNode {
  id: string;
  name: string;
  isActive?: boolean;
  fulfillsOnlineOrders?: boolean;
  address?: {
    country?: string;
    countryCode?: string;
  };
}

// In-memory cache for resolved fulfillment locations (10 min TTL)
const storeLocationCache = new Map<string, { locationId: string; timestamp: number }>();
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Resolves the optimal store fulfillment location ID for the target region.
 * Prioritizes active locations matching regional naming, then online fulfillment locations, then primary active.
 */
export function resolveFulfillmentLocation(locations: LocationNode[], region: Region): string | null {
  if (!locations || locations.length === 0) return null;

  const activeLocations = locations.filter((loc) => loc.isActive !== false);
  if (activeLocations.length === 0) return null;

  const regionUpper = region.toUpperCase();
  const regionalKeywords: Record<Region, string[]> = {
    nz: ["NZ", "NEW ZEALAND", "AUCKLAND", "WELLINGTON", "CHRISTCHURCH"],
    au: ["AU", "AUSTRALIA", "SYDNEY", "MELBOURNE", "BRISBANE"],
    sg: ["SG", "SINGAPORE"],
  };
  const targets = regionalKeywords[region] || [regionUpper];

  // 1. Regional warehouse match by location name or country/countryCode
  const regionalMatch = activeLocations.find((loc) => {
    const locNameUpper = (loc.name || "").toUpperCase();
    const countryUpper = (loc.address?.countryCode || loc.address?.country || "").toUpperCase();

    if (countryUpper === regionUpper) return true;

    return targets.some((kw) => {
      if (kw.length <= 2) {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        return regex.test(locNameUpper) || countryUpper === kw;
      }
      return locNameUpper.includes(kw) || countryUpper.includes(kw);
    });
  });

  if (regionalMatch) {
    return regionalMatch.id;
  }

  // 2. Active location configured to fulfill online orders
  const onlineFulfillment = activeLocations.find((loc) => loc.fulfillsOnlineOrders);
  if (onlineFulfillment) {
    return onlineFulfillment.id;
  }

  // 3. Fallback to first active location
  return activeLocations[0].id;
}

/**
 * Automatically queries and caches the primary fulfillment location for a store and region.
 */
export async function fetchStoreFulfillmentLocation(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  region: Region,
  shop?: string
): Promise<string | null> {
  const cacheKey = `${shop || "store"}:${region}`;
  const cached = storeLocationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LOCATION_CACHE_TTL_MS) {
    return cached.locationId;
  }

  try {
    const locRes = await admin.graphql(
      `#graphql
      query getFulfillmentLocations {
        locations(first: 20, includeInactive: false) {
          nodes {
            id
            name
            isActive
            fulfillsOnlineOrders
            address {
              country
              countryCode
            }
          }
        }
      }`
    );
    const locJson = await locRes.json();
    const locations = (locJson?.data?.locations?.nodes || []) as LocationNode[];
    const resolvedId = resolveFulfillmentLocation(locations, region);
    if (resolvedId) {
      storeLocationCache.set(cacheKey, { locationId: resolvedId, timestamp: Date.now() });
      return resolvedId;
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("Access denied for locations field") || errMsg.includes("locations")) {
      console.info(
        "[Shopify Sync] Notice: 'read_locations' scope not yet granted in Shopify Admin. Skipping location resolution."
      );
    } else {
      console.warn("[Shopify Sync] Could not retrieve locations:", errMsg);
    }
  }
  return null;
}

export interface LocationAllocation {
  locationId: string;
  quantity: number;
}

/**
 * Calculates stock quantities per target Shopify location according to distribution strategy:
 * - "single": 100% of variant stock allocated to the chosen targetLocationId.
 * - "split_equal": Stock divided equally across selected splitLocationIds with remainder (+1) distributed
 *   sequentially to preserve the exact total without dropping or creating units.
 */
export function allocateStockAcrossLocations(
  totalStock: number,
  mode: "single" | "split_equal",
  targetLocationId?: string | null,
  splitLocationIds?: string[] | null,
  fallbackLocationId?: string | null
): LocationAllocation[] {
  const safeTotal = Math.max(0, parseInt(String(totalStock), 10) || 0);

  if (mode === "split_equal") {
    const validLocations = (splitLocationIds || []).filter(Boolean);
    if (validLocations.length > 0) {
      const baseQty = Math.floor(safeTotal / validLocations.length);
      const remainder = safeTotal % validLocations.length;

      return validLocations.map((locId, idx) => ({
        locationId: locId,
        quantity: idx < remainder ? baseQty + 1 : baseQty,
      }));
    }
  }

  // Single location mode (or fallback if split_equal has no locations configured)
  const resolvedTarget = targetLocationId || fallbackLocationId;
  if (!resolvedTarget) {
    return [];
  }

  return [
    {
      locationId: resolvedTarget,
      quantity: safeTotal,
    },
  ];
}

export interface InventorySyncItem {
  inventoryItemId: string;
  quantity: number;
  locationId?: string; // Target location for this specific allocation
  sku?: string;
}

/**
 * Unpacks and formats GraphQL errors, network errors, and userErrors into readable diagnostic messages
 */
export function formatGraphQLErrors(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;

  if (Array.isArray(err)) {
    return err.map((e) => formatGraphQLErrors(e)).filter(Boolean).join("; ");
  }

  if (typeof err === "object") {
    const anyErr = err as Record<string, unknown>;

    // Shopify GraphQL client error with graphQLErrors array
    if (Array.isArray(anyErr.graphQLErrors) && anyErr.graphQLErrors.length > 0) {
      return anyErr.graphQLErrors
        .map((gErr: any) => {
          const msg = gErr.message || JSON.stringify(gErr);
          const code = gErr.extensions?.code ? ` (code: ${gErr.extensions.code})` : "";
          const path = Array.isArray(gErr.path) && gErr.path.length > 0 ? ` [path: ${gErr.path.join(".")}]` : "";
          return `${msg}${code}${path}`;
        })
        .join("; ");
    }

    // Top-level GraphQL errors in response body (json.errors)
    if (Array.isArray(anyErr.errors) && anyErr.errors.length > 0) {
      return anyErr.errors
        .map((e: any) => {
          const msg = e.message || JSON.stringify(e);
          const code = e.extensions?.code ? ` (code: ${e.extensions.code})` : "";
          const path = Array.isArray(e.path) && e.path.length > 0 ? ` [path: ${e.path.join(".")}]` : "";
          return `${msg}${code}${path}`;
        })
        .join("; ");
    }

    // UserErrors in GraphQL payload (userErrors: [{ field, message }])
    if (Array.isArray(anyErr.userErrors) && anyErr.userErrors.length > 0) {
      return anyErr.userErrors
        .map((u: any) => {
          const field = Array.isArray(u.field) ? ` [field: ${u.field.join(".")}]` : "";
          return `${u.message}${field}`;
        })
        .join("; ");
    }

    if (anyErr.message) {
      return String(anyErr.message);
    }

    try {
      return JSON.stringify(anyErr);
    } catch {
      return String(anyErr);
    }
  }

  return String(err);
}

/**
 * Validates and normalizes location ID to a valid Shopify Location GID format.
 * Returns null if not a valid location identifier.
 */
export function toValidShopifyLocationGid(locId: unknown): string | null {
  if (!locId) return null;
  const str = typeof locId === "string" ? locId.trim() : String(locId).trim();
  if (!str) return null;
  if (str.startsWith("gid://shopify/Location/")) return str;
  if (/^\d+$/.test(str)) return `gid://shopify/Location/${str}`;
  return null;
}

/**
 * Checks if an inventory item already has an active inventory level at the given location GID.
 */
export async function isInventoryItemActiveAtLocation(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  inventoryItemId: string,
  locationId: string
): Promise<boolean> {
  if (!inventoryItemId || !locationId) return false;
  try {
    const res = await admin.graphql(
      `#graphql
      query getInventoryItemLevels($id: ID!) {
        inventoryItem(id: $id) {
          id
          inventoryLevels(first: 25) {
            nodes {
              location {
                id
                isActive
              }
            }
          }
        }
      }`,
      {
        variables: { id: inventoryItemId },
      }
    );
    const json = await res.json();
    const levels = json?.data?.inventoryItem?.inventoryLevels?.nodes || [];
    return levels.some((lvl: any) => lvl?.location?.id === locationId);
  } catch (err) {
    console.warn(`[Shopify Sync] Could not check active inventory levels for item ${inventoryItemId}:`, formatGraphQLErrors(err));
    return false;
  }
}

/**
 * Explicitly enables inventory tracking and assigns available stock quantities
 * at the target warehouse location(s) using Shopify Admin GraphQL.
 */
export async function syncInventoryQuantities(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  locationId: string,
  items: InventorySyncItem[]
): Promise<void> {
  // Validate items: must have non-empty inventoryItemId and valid quantity
  const validItems = items.filter((it) => {
    if (!it.inventoryItemId || typeof it.inventoryItemId !== "string") return false;
    if (it.inventoryItemId.includes("ProductVariant")) {
      console.warn(
        `[Sync Logger] Warning: Variant ID provided instead of InventoryItem ID: ${it.inventoryItemId}. Skipping.`
      );
      return false;
    }
    return it.quantity >= 0;
  });

  if (validItems.length === 0) return;

  // Log parsed stock values before sending mutation
  for (const item of validItems) {
    const safeQty = Math.max(0, parseInt(String(item.quantity), 10) || 0);
    const rawLoc = item.locationId || locationId;
    const validatedLoc = toValidShopifyLocationGid(rawLoc);
    console.info(
      `[Sync Logger] Variant SKU: ${item.sku || item.inventoryItemId}, Location: ${validatedLoc || rawLoc}, Extracted Stock: ${safeQty}`
    );
  }

  // 1. Explicitly enable inventory tracking on each variant's inventory item
  const uniqueInventoryItemIds = Array.from(new Set(validItems.map((it) => it.inventoryItemId)));
  await Promise.allSettled(
    uniqueInventoryItemIds.map(async (invId) => {
      try {
        const trackRes = await admin.graphql(
          `#graphql
          mutation enableInventoryTracking($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem {
                id
                tracked
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              id: invId,
              input: {
                tracked: true,
              },
            },
          }
        );
        const trackJson = await trackRes.json();
        const trackErrors = trackJson?.errors || trackJson?.data?.inventoryItemUpdate?.userErrors || [];
        if (trackErrors.length > 0) {
          console.warn("[Shopify Sync] enableInventoryTracking warning for item", invId, formatGraphQLErrors(trackErrors));
        }
      } catch (trackErr) {
        console.warn("[Shopify Sync] enableInventoryTracking exception for item", invId, formatGraphQLErrors(trackErr));
      }
    })
  );

  // 2. Pre-activate each inventory item at all assigned target locations (only for valid GIDs)
  const itemLocationMap = new Map<string, Set<string>>();
  for (const item of validItems) {
    const rawLoc = item.locationId || locationId;
    const validLoc = toValidShopifyLocationGid(rawLoc);
    if (validLoc) {
      if (!itemLocationMap.has(item.inventoryItemId)) {
        itemLocationMap.set(item.inventoryItemId, new Set());
      }
      itemLocationMap.get(item.inventoryItemId)!.add(validLoc);
    } else {
      console.warn(`[Shopify Sync] Ignoring unresolvable location ID "${rawLoc}" for item ${item.inventoryItemId}`);
    }
  }

  await Promise.allSettled(
    Array.from(itemLocationMap.entries()).map(async ([invId, locSet]) => {
      try {
        const locationsToActivate: Array<{ locationId: string; activate: boolean }> = [];
        for (const loc of locSet) {
          const alreadyActive = await isInventoryItemActiveAtLocation(admin, invId, loc);
          if (!alreadyActive) {
            locationsToActivate.push({ locationId: loc, activate: true });
          }
        }

        if (locationsToActivate.length === 0) {
          return;
        }

        const actRes = await admin.graphql(
          `#graphql
          mutation activateInventoryAtLocations($inventoryItemId: ID!, $inventoryItemUpdates: [InventoryBulkToggleActivationInput!]!) {
            inventoryBulkToggleActivation(inventoryItemId: $inventoryItemId, inventoryItemUpdates: $inventoryItemUpdates) {
              inventoryItem {
                id
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              inventoryItemId: invId,
              inventoryItemUpdates: locationsToActivate,
            },
          }
        );
        const actJson = await actRes.json();
        const actErrors = actJson?.errors || actJson?.data?.inventoryBulkToggleActivation?.userErrors || [];
        if (actErrors.length > 0) {
          console.warn(
            `[Shopify Sync] activateInventoryAtLocations warning for item ${invId}:`,
            formatGraphQLErrors(actErrors)
          );
        }
      } catch (actErr) {
        console.warn(
          `[Shopify Sync] activateInventoryAtLocations exception for item ${invId}:`,
          formatGraphQLErrors(actErr)
        );
      }
    })
  );

  // 3. Set available inventory quantities via inventorySetQuantities
  const quantitiesInput = validItems
    .map((item) => {
      const rawLoc = item.locationId || locationId;
      const validLoc = toValidShopifyLocationGid(rawLoc);
      if (!validLoc) return null;
      return {
        inventoryItemId: item.inventoryItemId,
        locationId: validLoc,
        quantity: Math.max(0, parseInt(String(item.quantity), 10) || 0),
        changeFromQuantity: null,
      };
    })
    .filter((q): q is { inventoryItemId: string; locationId: string; quantity: number; changeFromQuantity: null } => q !== null);

  if (quantitiesInput.length === 0) {
    console.warn("[Shopify Sync] No valid inventory quantities to set (all location IDs invalid).");
    return;
  }

  try {
    const setRes = await admin.graphql(
      `#graphql
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            changes {
              name
              delta
              quantityAfterChange
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            name: "available",
            reason: "correction",
            quantities: quantitiesInput,
          },
        },
      }
    );

    const setJson = await setRes.json();
    const topErrors = setJson?.errors || [];
    const userErrors: Array<{ field?: string[]; message: string }> =
      setJson?.data?.inventorySetQuantities?.userErrors || [];
    const changes = setJson?.data?.inventorySetQuantities?.inventoryAdjustmentGroup?.changes || [];

    if (topErrors.length > 0 || userErrors.length > 0) {
      const allErrors = [...topErrors, ...userErrors];
      console.warn(
        `[Sync Logger] Shopify inventorySetQuantities batch error:`,
        formatGraphQLErrors(allErrors)
      );

      // Fallback: Retry setting quantities individually with location activation
      for (const item of validItems) {
        const rawLocation = item.locationId || locationId;
        const validLocId = toValidShopifyLocationGid(rawLocation);
        if (!validLocId) {
          console.warn(
            `[Shopify Sync] Skipping individual fallback for item ${item.inventoryItemId}: location "${rawLocation}" is not a valid Shopify Location GID.`
          );
          continue;
        }

        try {
          const alreadyActive = await isInventoryItemActiveAtLocation(admin, item.inventoryItemId, validLocId);
          if (!alreadyActive) {
            const actRes = await admin.graphql(
              `#graphql
              mutation retryLocationActivation($inventoryItemId: ID!, $inventoryItemUpdates: [InventoryBulkToggleActivationInput!]!) {
                inventoryBulkToggleActivation(inventoryItemId: $inventoryItemId, inventoryItemUpdates: $inventoryItemUpdates) {
                  inventoryItem {
                    id
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }`,
              {
                variables: {
                  inventoryItemId: item.inventoryItemId,
                  inventoryItemUpdates: [{ locationId: validLocId, activate: true }],
                },
              }
            );
            const actJson = await actRes.json();
            const actErrors = actJson?.errors || actJson?.data?.inventoryBulkToggleActivation?.userErrors || [];
            if (actErrors.length > 0) {
              console.warn(
                `[Shopify Sync] retryLocationActivation failed for item ${item.inventoryItemId} at ${validLocId}:`,
                formatGraphQLErrors(actErrors)
              );
            }
          }

          const setIndRes = await admin.graphql(
            `#graphql
            mutation retryIndividualSetQuantity($input: InventorySetQuantitiesInput!) {
              inventorySetQuantities(input: $input) {
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                input: {
                  name: "available",
                  reason: "correction",
                  quantities: [
                    {
                      inventoryItemId: item.inventoryItemId,
                      locationId: validLocId,
                      quantity: Math.max(0, parseInt(String(item.quantity), 10) || 0),
                      changeFromQuantity: null,
                    },
                  ],
                },
              },
            }
          );
          const setIndJson = await setIndRes.json();
          const indErrors = setIndJson?.errors || setIndJson?.data?.inventorySetQuantities?.userErrors || [];
          if (indErrors.length > 0) {
            console.warn(
              `[Shopify Sync] retryIndividualSetQuantity error for item ${item.inventoryItemId}:`,
              formatGraphQLErrors(indErrors)
            );
          }
        } catch (retryErr) {
          console.warn(
            `[Shopify Sync] Individual quantity fallback warning for item ${item.inventoryItemId}:`,
            formatGraphQLErrors(retryErr)
          );
        }
      }
    } else {
      const locSet = Array.from(new Set(quantitiesInput.map((it) => it.locationId)));
      console.info(
        `[Sync Logger] Successfully updated inventory for ${quantitiesInput.length} allocation(s) across ${locSet.length} location(s). Stock adjustments: ${changes.length}`
      );
    }
  } catch (setErr) {
    console.warn(
      "[Shopify Sync] inventorySetQuantities batch error, attempting individual fallback:",
      formatGraphQLErrors(setErr)
    );
    for (const item of validItems) {
      const rawLocation = item.locationId || locationId;
      const validLocId = toValidShopifyLocationGid(rawLocation);
      if (!validLocId) {
        console.warn(
          `[Shopify Sync] Skipping fallback for item ${item.inventoryItemId}: location "${rawLocation}" is not a valid Shopify Location GID.`
        );
        continue;
      }

      try {
        const isAlreadyActive = await isInventoryItemActiveAtLocation(admin, item.inventoryItemId, validLocId);
        if (!isAlreadyActive) {
          const actRes = await admin.graphql(
            `#graphql
            mutation fallbackLocationActivation($inventoryItemId: ID!, $inventoryItemUpdates: [InventoryBulkToggleActivationInput!]!) {
              inventoryBulkToggleActivation(inventoryItemId: $inventoryItemId, inventoryItemUpdates: $inventoryItemUpdates) {
                inventoryItem {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                inventoryItemId: item.inventoryItemId,
                inventoryItemUpdates: [{ locationId: validLocId, activate: true }],
              },
            }
          );
          const actJson = await actRes.json();
          const actErrors = actJson?.errors || actJson?.data?.inventoryBulkToggleActivation?.userErrors || [];
          if (actErrors.length > 0) {
            console.warn(
              `[Shopify Sync] fallbackLocationActivation error for item ${item.inventoryItemId} at ${validLocId}:`,
              formatGraphQLErrors(actErrors)
            );
          }
        }

        const setRes = await admin.graphql(
          `#graphql
          mutation fallbackIndividualSetQuantity($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              input: {
                name: "available",
                reason: "correction",
                quantities: [
                  {
                    inventoryItemId: item.inventoryItemId,
                    locationId: validLocId,
                    quantity: Math.max(0, parseInt(String(item.quantity), 10) || 0),
                    changeFromQuantity: null,
                  },
                ],
              },
            },
          }
        );
        const setJson = await setRes.json();
        const setErrors = setJson?.errors || setJson?.data?.inventorySetQuantities?.userErrors || [];
        if (setErrors.length > 0) {
          console.warn(
            `[Shopify Sync] fallbackIndividualSetQuantity error for item ${item.inventoryItemId}:`,
            formatGraphQLErrors(setErrors)
          );
        }
      } catch (indErr) {
        console.warn(
          `[Shopify Sync] Individual inventory update fallback exception for item ${item.inventoryItemId}:`,
          formatGraphQLErrors(indErr)
        );
      }
    }
  }
}

// ==========================================
// VARIANT IMAGE & MEDIA MAPPING PIPELINE
// ==========================================

export interface VariantImageMapping {
  stockCode: string;
  canonicalSku: string;
  optionValue: string;
  imageUrl: string | null;
  altText: string;
  matchType: "variant_field" | "stock_code" | "colour_exact" | "colour_fuzzy" | "fallback" | "none";
}

export interface CapturedProductMedia {
  id: string;
  alt?: string | null;
  url?: string | null;
  originalSource?: string | null;
}

export interface ProductMediaSyncResult {
  mediaNodes: CapturedProductMedia[];
  urlToMediaId: Map<string, string>;
  altToMediaId: Map<string, string>;
  variantSkuToImageUrl: Map<string, string>;
  variantImageMappings: VariantImageMapping[];
}

/**
 * Safely converts any input into a clean trimmed string.
 * Coerces null or undefined to empty string.
 */
export function toSafeString(input: unknown): string {
  if (input === null || input === undefined) return "";
  return typeof input === "string" ? input.trim() : String(input).trim();
}

/**
 * Safely normalizes strings, numbers, or unknown inputs for resilient color and code matching.
 * Coerces null, undefined, numbers, or objects to clean lowercase alphanumeric strings.
 */
export function normalizeColorOrCode(input: unknown): string {
  if (input === null || input === undefined) return "";
  let str: string;
  if (typeof input === "string") {
    str = input;
  } else if (typeof input === "number" || typeof input === "boolean" || typeof input === "bigint") {
    str = String(input);
  } else if (typeof input === "object") {
    try {
      str = JSON.stringify(input);
    } catch {
      str = String(input);
    }
  } else {
    str = String(input);
  }

  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches a single VariantSpec to its corresponding Trends image.
 * Priority:
 * 1. Dedicated variant-level image field (e.g. stock item has image_url / imageUrl / link)
 * 2. Dedicated stock_code match on ImageData
 * 3. Exact color match on ImageData
 * 4. Fuzzy / word-boundary color match on ImageData
 * 5. Defensive fallback to primary product image (trendsProduct.images[0])
 */
export function matchVariantImage(
  spec: VariantSpec,
  trendsProduct: ProductData
): { imageUrl: string | null; altText: string; matchType: VariantImageMapping["matchType"] } {
  const images = Array.isArray(trendsProduct.images) ? trendsProduct.images : [];
  const primaryUrl = images.length > 0 ? sanitizeImageUrl(images[0]?.link) : null;
  const productName = toSafeString(trendsProduct.name) || "Product";
  const specOptStr = toSafeString(spec?.optionValue);
  const defaultAlt = `${productName} - ${specOptStr || "Standard"}`;

  const cleanSpecCode = normalizeColorOrCode(spec?.stockCode);
  const cleanSpecSku = normalizeColorOrCode(spec?.canonicalSku);
  const cleanOption = normalizeColorOrCode(specOptStr);
  const baseColorCandidate = normalizeColorOrCode(specOptStr.split(/[-–—/()]/)[0]);

  // 1. Direct variant-level image field (e.g. stock item has image_url / imageUrl / link)
  if (Array.isArray(trendsProduct.stock)) {
    const matchedStock = trendsProduct.stock.find((s) => {
      if (!s || s.stock_code === undefined || s.stock_code === null) return false;
      const sCode = normalizeColorOrCode(s.stock_code);
      return sCode && (sCode === cleanSpecCode || sCode === cleanSpecSku);
    });
    if (matchedStock) {
      const stockImgUrl =
        (matchedStock as any).image_url ||
        (matchedStock as any).imageUrl ||
        (matchedStock as any).image ||
        (matchedStock as any).link;
      const sanitized = sanitizeImageUrl(toSafeString(stockImgUrl));
      if (sanitized) {
        return { imageUrl: sanitized, altText: defaultAlt, matchType: "variant_field" };
      }
    }
  }

  // 2. Direct stock_code match on ImageData
  if (cleanSpecCode) {
    const imgByStock = images.find((img) => {
      if (!img || img.stock_code === undefined || img.stock_code === null) return false;
      const cleanImgCode = normalizeColorOrCode(img.stock_code);
      return (
        cleanImgCode &&
        (cleanImgCode === cleanSpecCode ||
          cleanSpecCode.includes(cleanImgCode) ||
          cleanImgCode.includes(cleanSpecCode) ||
          cleanSpecSku.includes(cleanImgCode))
      );
    });
    if (imgByStock) {
      const sanitized = sanitizeImageUrl(toSafeString(imgByStock.link));
      if (sanitized) {
        const imgColourStr = toSafeString(imgByStock.colour);
        return {
          imageUrl: sanitized,
          altText: imgColourStr ? `${productName} - ${imgColourStr}` : defaultAlt,
          matchType: "stock_code",
        };
      }
    }
  }

  // 3. Exact colour match on ImageData
  for (const img of images) {
    if (!img || img.colour === undefined || img.colour === null) continue;
    const cleanColour = normalizeColorOrCode(img.colour);
    if (!cleanColour) continue;

    if (cleanColour === cleanOption || (baseColorCandidate && cleanColour === baseColorCandidate)) {
      const sanitized = sanitizeImageUrl(toSafeString(img.link));
      if (sanitized) {
        return {
          imageUrl: sanitized,
          altText: `${productName} - ${toSafeString(img.colour)}`,
          matchType: "colour_exact",
        };
      }
    }
  }

  // 4. Fuzzy / word-boundary colour match on ImageData
  for (const img of images) {
    if (!img || img.colour === undefined || img.colour === null) continue;
    const cleanColour = normalizeColorOrCode(img.colour);
    if (!cleanColour || cleanColour.length < 2) continue;

    const escaped = cleanColour.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");

    if (
      (cleanOption && regex.test(cleanOption)) ||
      (baseColorCandidate && regex.test(baseColorCandidate))
    ) {
      const sanitized = sanitizeImageUrl(toSafeString(img.link));
      if (sanitized) {
        return {
          imageUrl: sanitized,
          altText: `${productName} - ${toSafeString(img.colour)}`,
          matchType: "colour_fuzzy",
        };
      }
    }
  }

  // 5. Defensive fallback to primary product image
  if (primaryUrl) {
    const firstImg = images[0];
    const firstImgColour = toSafeString(firstImg?.colour);
    return {
      imageUrl: primaryUrl,
      altText: firstImgColour ? `${productName} - ${firstImgColour}` : productName,
      matchType: "fallback",
    };
  }

  return {
    imageUrl: null,
    altText: defaultAlt,
    matchType: "none",
  };
}

/**
 * Extracts dedicated image URLs for each variant based on color, SKU, or image fields.
 * Maintains key-value mapping of variantSku / stockCode / color -> imageUrl.
 */
export function extractVariantImageMappings(
  trendsProduct: ProductData,
  specs: VariantSpec[]
): {
  mappings: VariantImageMapping[];
  skuToImageUrl: Map<string, string>;
  stockCodeToImageUrl: Map<string, string>;
  colorToImageUrl: Map<string, string>;
} {
  const mappings: VariantImageMapping[] = [];
  const skuToImageUrl = new Map<string, string>();
  const stockCodeToImageUrl = new Map<string, string>();
  const colorToImageUrl = new Map<string, string>();

  for (const spec of specs) {
    const match = matchVariantImage(spec, trendsProduct);
    const stockCodeStr = toSafeString(spec?.stockCode);
    const skuStr = toSafeString(spec?.canonicalSku);
    const optValStr = toSafeString(spec?.optionValue);

    const mapping: VariantImageMapping = {
      stockCode: stockCodeStr,
      canonicalSku: skuStr,
      optionValue: optValStr,
      imageUrl: match.imageUrl,
      altText: match.altText,
      matchType: match.matchType,
    };
    mappings.push(mapping);

    if (match.imageUrl) {
      if (skuStr) skuToImageUrl.set(skuStr, match.imageUrl);
      if (stockCodeStr) stockCodeToImageUrl.set(stockCodeStr, match.imageUrl);
      const normalizedColorKey = normalizeColorOrCode(optValStr);
      if (normalizedColorKey) {
        colorToImageUrl.set(normalizedColorKey, match.imageUrl);
      }
    }
  }

  return {
    mappings,
    skuToImageUrl,
    stockCodeToImageUrl,
    colorToImageUrl,
  };
}

/**
 * Synchronizes product media on Shopify:
 * 1. Queries existing product media on Shopify (capturing MediaImage nodes and IDs).
 * 2. Uploads any missing product/variant images via productCreateMedia.
 * 3. Captures mediaUserErrors and resulting media nodes (id, originalSource, url, alt).
 * 4. Returns consolidated media nodes and lookup maps.
 */
export async function syncProductMedia(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  productId: string,
  trendsProduct: ProductData,
  variantImageMappings: VariantImageMapping[]
): Promise<ProductMediaSyncResult> {
  const mediaNodes: CapturedProductMedia[] = [];
  const urlToMediaId = new Map<string, string>();
  const altToMediaId = new Map<string, string>();

  // 1. Query existing media from Shopify product
  try {
    const queryRes = await admin.graphql(
      `#graphql
      query getProductMedia($id: ID!) {
        product(id: $id) {
          media(first: 50) {
            nodes {
              id
              alt
              status
              mediaContentType
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
        }
      }`,
      {
        variables: { id: productId },
      }
    );
    const queryJson = await queryRes.json();
    const existingNodes = queryJson?.data?.product?.media?.nodes || [];

    for (const node of existingNodes) {
      if (!node?.id) continue;
      const captured: CapturedProductMedia = {
        id: node.id,
        alt: node.alt || null,
        url: node.image?.url || null,
      };
      mediaNodes.push(captured);
      if (captured.url) {
        urlToMediaId.set(captured.url, captured.id);
      }
      if (captured.alt) {
        altToMediaId.set(normalizeColorOrCode(captured.alt), captured.id);
      }
    }
  } catch (queryErr) {
    console.warn("[Shopify Sync] Could not query existing product media:", formatGraphQLErrors(queryErr));
  }

  // 2. Identify candidate images to upload
  const candidates: Array<{ url: string; alt: string }> = [];
  const seenUrls = new Set<string>();

  if (Array.isArray(trendsProduct.images)) {
    for (const img of trendsProduct.images) {
      if (!img) continue;
      const validUrl = sanitizeImageUrl(toSafeString(img.link));
      if (!validUrl || seenUrls.has(validUrl)) continue;
      seenUrls.add(validUrl);
      const colStr = toSafeString(img.colour);
      const stkStr = toSafeString(img.stock_code);
      const pName = toSafeString(trendsProduct.name) || "Product";
      const alt = colStr
        ? `${pName} - ${colStr}`
        : (stkStr ? `${pName} [${stkStr}]` : pName);
      candidates.push({ url: validUrl, alt });
    }
  }

  for (const m of variantImageMappings) {
    if (!m.imageUrl) continue;
    const validUrl = sanitizeImageUrl(toSafeString(m.imageUrl));
    if (!validUrl || seenUrls.has(validUrl)) continue;
    seenUrls.add(validUrl);
    candidates.push({ url: validUrl, alt: m.altText });
  }

  // 3. Filter candidates that are not yet on Shopify
  const mediaToUpload = candidates
    .filter((c) => {
      if (urlToMediaId.has(c.url)) return false;
      if (c.alt && altToMediaId.has(normalizeColorOrCode(c.alt))) return false;
      return true;
    })
    .slice(0, 15);

  // 4. Upload missing media via productCreateMedia
  if (mediaToUpload.length > 0) {
    try {
      const mediaList = mediaToUpload.map((m) => ({
        originalSource: m.url,
        mediaContentType: "IMAGE" as const,
        alt: m.alt,
      }));

      const mediaRes = await admin.graphql(
        `#graphql
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              id
              alt
              status
              mediaContentType
              ... on MediaImage {
                image {
                  url
                }
              }
            }
            mediaUserErrors {
              code
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId,
            media: mediaList,
          },
        }
      );

      const mediaJson = await mediaRes.json();
      const mediaTopErrors = mediaJson?.errors || [];
      const mediaUserErrors = mediaJson?.data?.productCreateMedia?.mediaUserErrors || [];
      if (mediaTopErrors.length > 0 || mediaUserErrors.length > 0) {
        console.warn(
          "[Shopify Sync] Image upload warnings:",
          formatGraphQLErrors([...mediaTopErrors, ...mediaUserErrors])
        );
      }

      const createdMedia = mediaJson?.data?.productCreateMedia?.media || [];
      createdMedia.forEach((m: any, idx: number) => {
        if (!m?.id) return;
        const sourceUrl = mediaToUpload[idx]?.url;
        const alt = m.alt || mediaToUpload[idx]?.alt;
        const captured: CapturedProductMedia = {
          id: m.id,
          alt: alt || null,
          url: m.image?.url || null,
          originalSource: sourceUrl,
        };
        mediaNodes.push(captured);
        if (sourceUrl) {
          urlToMediaId.set(sourceUrl, m.id);
        }
        if (captured.url) {
          urlToMediaId.set(captured.url, m.id);
        }
        if (alt) {
          altToMediaId.set(normalizeColorOrCode(alt), m.id);
        }
      });
    } catch (createMediaErr) {
      console.warn("[Shopify Sync] Image upload pipeline exception (non-fatal):", formatGraphQLErrors(createMediaErr));
    }
  }

  const variantSkuToImageUrl = new Map<string, string>();
  for (const m of variantImageMappings) {
    if (m.imageUrl) {
      if (m.canonicalSku) variantSkuToImageUrl.set(m.canonicalSku, m.imageUrl);
      if (m.stockCode) variantSkuToImageUrl.set(m.stockCode, m.imageUrl);
    }
  }

  return {
    mediaNodes,
    urlToMediaId,
    altToMediaId,
    variantSkuToImageUrl,
    variantImageMappings,
  };
}

/**
 * Assigns media IDs to product variants via productVariantsBulkUpdate.
 * Matches uploaded media back to variants by image URL or alt text,
 * with fallback to the primary product image.
 * Batches in chunks of 50 variants.
 */
export async function assignVariantMedia(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  productId: string,
  variantLedgerEntries: Array<{ shopifyVariantId: string; stockCode: string }>,
  specs: VariantSpec[],
  variantImageMappings: VariantImageMapping[],
  mediaResult: {
    mediaNodes: CapturedProductMedia[];
    urlToMediaId: Map<string, string>;
    altToMediaId: Map<string, string>;
  },
  trendsProductName: string
): Promise<void> {
  const { mediaNodes, urlToMediaId, altToMediaId } = mediaResult;
  if (mediaNodes.length === 0) return;

  const primaryMediaId = mediaNodes[0]?.id || null;
  const variantUpdates: Array<{ id: string; mediaId: string }> = [];

  for (const entry of variantLedgerEntries) {
    if (!entry.shopifyVariantId || !entry.shopifyVariantId.startsWith("gid://shopify/ProductVariant/")) {
      continue;
    }

    const cleanEntryStockCode = normalizeColorOrCode(entry.stockCode);
    const spec = specs.find((s) => normalizeColorOrCode(s?.stockCode) === cleanEntryStockCode);
    const mapping = variantImageMappings.find((m) => normalizeColorOrCode(m?.stockCode) === cleanEntryStockCode);

    let matchedMediaId: string | null = null;

    // 1. Direct URL match from mapping
    if (mapping?.imageUrl) {
      matchedMediaId = urlToMediaId.get(mapping.imageUrl) || null;
    }

    // 2. Alt text exact match from mapping
    if (!matchedMediaId && mapping?.altText) {
      matchedMediaId = altToMediaId.get(normalizeColorOrCode(mapping.altText)) || null;
    }

    // 3. Alt text match by optionValue / color
    if (!matchedMediaId && spec?.optionValue) {
      const optStr = toSafeString(spec.optionValue);
      const cleanOption = normalizeColorOrCode(optStr);
      const baseOption = normalizeColorOrCode(optStr.split(/[-–—/()]/)[0]);

      const foundNode = mediaNodes.find((node) => {
        if (!node.alt) return false;
        const cleanAlt = normalizeColorOrCode(node.alt);
        return (
          (cleanOption && (cleanAlt.includes(cleanOption) || cleanOption.includes(cleanAlt))) ||
          (baseOption && (cleanAlt.includes(baseOption) || baseOption.includes(cleanAlt)))
        );
      });
      if (foundNode) {
        matchedMediaId = foundNode.id;
      }
    }

    // 4. Defensive Fallback to primary product image
    if (!matchedMediaId) {
      matchedMediaId = primaryMediaId;
    }

    if (matchedMediaId) {
      variantUpdates.push({
        id: entry.shopifyVariantId,
        mediaId: matchedMediaId,
      });
    }
  }

  // Batch variant updates in chunks of 50
  const CHUNK_SIZE = 50;
  for (let i = 0; i < variantUpdates.length; i += CHUNK_SIZE) {
    const chunk = variantUpdates.slice(i, i + CHUNK_SIZE);
    try {
      const bulkRes = await admin.graphql(
        `#graphql
        mutation bulkAssignVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId,
            variants: chunk,
          },
        }
      );
      const bulkJson = await bulkRes.json();
      const bulkErrors = [...(bulkJson?.errors || []), ...(bulkJson?.data?.productVariantsBulkUpdate?.userErrors || [])];
      if (bulkErrors.length > 0) {
        console.warn(
          "[Shopify Sync] Variant media bulk update warnings:",
          formatGraphQLErrors(bulkErrors)
        );
      }
    } catch (err) {
      console.warn("[Shopify Sync] Variant media assignment error (non-fatal):", formatGraphQLErrors(err));
    }
  }
}

/**
 * Synchronizes a TRENDS product to Shopify Admin GraphQL
 * Creates or updates product, sets canonical SKUs, assigns metafields,
 * updates inventory, and tracks sync status in Postgres.
 */
export async function syncTrendProductToShopify(options: SyncTrendProductOptions): Promise<SyncTrendProductResult> {
  const {
    admin,
    shop,
    region,
    syncLocks = [],
    isMock,
    inventorySyncMode: explicitMode,
    targetLocationId: explicitTargetLoc,
    splitLocationIds: explicitSplitLocs,
  } = options;
  let trendsProduct = options.trendsProduct;
  const trendsCode = String(trendsProduct.code);
  const normalizedRegion = region.toLowerCase() as Region;

  // Detect whether this is a mock product so we tag and flag it in Shopify
  const isMockProduct = Boolean(
    isMock ||
    (trendsProduct as any).is_mock ||
    process.env.ENABLE_TRENDS_MOCK_FALLBACK === "true" ||
    trendsProduct.images?.[0]?.link?.includes("unsplash.com")
  );

  // 1. Check local PostgreSQL sync ledger first
  let existingSync = await prisma.trendProductSync.findFirst({
    where: {
      shop,
      trendsCode,
    },
    include: {
      variants: true,
    },
  });

  let shopifyProductId = existingSync?.shopifyProductId;
  let shopifyHandle: string | undefined;

  // Resolve effective inventory distribution strategy:
  // 1. Explicit options passed to syncTrendProductToShopify (if any)
  // 2. Product-level override from local DB (existingSync)
  // 3. Global AppSettings
  const appSettings = await getAppSettings(shop);
  const effectiveMode: "single" | "split_equal" =
    explicitMode ||
    (existingSync?.inventorySyncMode as "single" | "split_equal" | null) ||
    appSettings.inventorySyncMode ||
    "single";
  const effectiveTargetLocationId: string | null =
    explicitTargetLoc !== undefined
      ? explicitTargetLoc
      : existingSync?.targetLocationId !== undefined
      ? existingSync.targetLocationId
      : appSettings.targetLocationId || null;
  const effectiveSplitLocationIds: string[] =
    explicitSplitLocs !== undefined
      ? explicitSplitLocs
      : existingSync?.splitLocationIds && existingSync.splitLocationIds.length > 0
      ? existingSync.splitLocationIds
      : appSettings.splitLocationIds || [];

  // 2. Ensure product has live stock data from Trends API stock endpoint (/api/v1/stock/{id}.json)
  if (trendsCode) {
    try {
      const stockRes = await TrendsApiClient.request<any>(normalizedRegion, `stock/${trendsCode}`);
      const extractedStock = parseTrendsStockResponse(stockRes?.data);
      if (extractedStock.length > 0) {
        trendsProduct = {
          ...trendsProduct,
          stock: extractedStock.map((es) => ({
            stock_code: es.stockCode,
            description: es.description,
            quantity: es.quantity,
            next_shipment: es.nextShipment,
            due_date: es.dueDate,
          })),
        };
      }
    } catch (stockFetchErr) {
      console.warn(`[Shopify Sync] Could not fetch live stock for product ${trendsCode}:`, stockFetchErr);
    }
  }

  // 3. Extract base price & variant specifications
  const primaryPrice = extractBasePrice(trendsProduct, normalizedRegion);
  const { optionName, specs } = buildVariantSpecs(trendsProduct, normalizedRegion, trendsCode);
  const skuList: string[] = specs.map((s) => s.canonicalSku);
  const variantLedgerEntries: {
    shopifyVariantId: string;
    inventoryItemId?: string;
    stockCode: string;
    quantity: number;
  }[] = [];

  // 4. Execute Shopify Admin GraphQL if admin client is available
  if (admin) {
    // If not in local DB, check if product already exists in Shopify by tag/metafield
    if (!shopifyProductId) {
      try {
        const findRes = await admin.graphql(
          `#graphql
          query findProductByTag($query: String!) {
            products(first: 1, query: $query) {
              nodes {
                id
                handle
                title
                totalInventory
                variants(first: 50) {
                  nodes {
                    id
                    sku
                    inventoryQuantity
                    availableForSale
                    inventoryPolicy
                    inventoryItem {
                      id
                      sku
                      tracked
                    }
                  }
                }
              }
            }
          }`,
          {
            variables: {
              query: `tag:trends_code:${trendsCode}`,
            },
          }
        );
        const findJson = await findRes.json();
        const found = findJson?.data?.products?.nodes?.[0];
        if (found?.id) {
          shopifyProductId = found.id;
          shopifyHandle = found.handle;
        }
      } catch (err) {
        console.warn("[Shopify Sync] Could not check existing product in Shopify:", err);
      }
    }

    // Resolve active primary fulfillment location (cached)
    const primaryLocationId = await fetchStoreFulfillmentLocation(admin, normalizedRegion, shop);

    const metafields = [
      {
        namespace: "trends",
        key: "product_code",
        type: "single_line_text_field",
        value: trendsCode,
      },
      {
        namespace: "trends",
        key: "primary_region",
        type: "single_line_text_field",
        value: normalizedRegion,
      },
      {
        namespace: "trends",
        key: "branding_options",
        type: "json",
        value: JSON.stringify(trendsProduct.branding_options || []),
      },
      {
        namespace: "trends",
        key: "lead_times",
        type: "json",
        value: JSON.stringify(trendsProduct.additional_specifications || []),
      },
      {
        namespace: "trends",
        key: "quantity_breaks",
        type: "json",
        value: JSON.stringify(normalizePricing(trendsProduct.pricing)[0]?.prices || []),
      },
      {
        namespace: "trends",
        key: "sync_locks",
        type: "json",
        value: JSON.stringify(syncLocks),
      },
      {
        namespace: "trends",
        key: "last_synced_at",
        type: "date_time",
        value: new Date().toISOString(),
      },
      ...(isMockProduct
        ? [
            {
              namespace: "trends",
              key: "is_mock",
              type: "single_line_text_field",
              value: "true",
            },
          ]
        : []),
    ];

    if (!shopifyProductId) {
      // --- CREATE NEW PRODUCT ---
      const productInput: Record<string, unknown> = {
        title: trendsProduct.name,
        descriptionHtml: buildDescriptionHtml(trendsProduct),
        vendor: "TRENDS Collection",
        productType: trendsProduct.categories?.[0]?.name || "Promotional Product",
        tags: [
          "supplier:trends",
          `trends_code:${trendsCode}`,
          `region:${normalizedRegion}`,
          ...(trendsProduct.categories?.map((c) => c.name) || []),
          ...(isMockProduct ? ["trends:mock"] : []),
        ],
        metafields,
        productOptions: [
          {
            name: optionName,
            values: specs.map((s) => ({ name: s.optionValue })),
          },
        ],
      };

      const createRes = await admin.graphql(
        `#graphql
        mutation productCreate($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product {
              id
              title
              handle
              variants(first: 50) {
                nodes {
                  id
                  sku
                  inventoryQuantity
                  availableForSale
                  inventoryPolicy
                  inventoryItem {
                    id
                    sku
                    tracked
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            product: productInput,
          },
        }
      );

      const createJson = await createRes.json();
      const createdProduct = createJson?.data?.productCreate?.product;
      const userErrors = createJson?.data?.productCreate?.userErrors || [];

      if (userErrors.length > 0 || !createdProduct?.id) {
        throw new Error(
          `Shopify productCreate failed: ${userErrors.map((e: { message: string }) => e.message).join(", ")}`
        );
      }

      shopifyProductId = createdProduct.id;
      shopifyHandle = createdProduct.handle;

      // --- CONSTRUCT & SYNC VARIANTS ---
      if (specs.length === 1) {
        // Single variant: update the standalone variant created by productCreate
        const firstVariant = createdProduct.variants?.nodes?.[0];
        if (firstVariant?.id) {
          try {
            await admin.graphql(
              `#graphql
              mutation updateSingleVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                  productVariants {
                    id
                    price
                    inventoryItem {
                      id
                      sku
                    }
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }`,
              {
                variables: {
                  productId: shopifyProductId,
                  variants: [
                    {
                      id: firstVariant.id,
                      price: primaryPrice,
                      inventoryPolicy: "DENY",
                      inventoryItem: {
                        sku: specs[0].canonicalSku,
                        tracked: true,
                      },
                      metafields: [
                        {
                          namespace: "trends",
                          key: "stock_code",
                          type: "single_line_text_field",
                          value: specs[0].stockCode,
                        },
                      ],
                    },
                  ],
                },
              }
            );

            variantLedgerEntries.push({
              shopifyVariantId: firstVariant.id,
              inventoryItemId: firstVariant.inventoryItem?.id,
              stockCode: specs[0].stockCode,
              quantity: specs[0].quantity,
            });

            // Adjust inventory for single variant across configured locations
            if (primaryLocationId && firstVariant.inventoryItem?.id) {
              const allocations = allocateStockAcrossLocations(
                specs[0].quantity,
                effectiveMode,
                effectiveTargetLocationId,
                effectiveSplitLocationIds,
                primaryLocationId
              );
              const itemsToSync: InventorySyncItem[] = allocations.map((alloc) => ({
                inventoryItemId: firstVariant.inventoryItem.id,
                quantity: alloc.quantity,
                locationId: alloc.locationId,
                sku: specs[0].canonicalSku,
              }));
              await syncInventoryQuantities(admin, primaryLocationId, itemsToSync);
            }
          } catch (varErr) {
            console.warn("[Shopify Sync] Single variant update skipped:", varErr);
            variantLedgerEntries.push({
              shopifyVariantId: firstVariant.id,
              inventoryItemId: firstVariant.inventoryItem?.id,
              stockCode: specs[0].stockCode,
              quantity: specs[0].quantity,
            });
          }
        }
      } else {
        // Multi-variant matrix: Replace standalone variant with complete matrix via productVariantsBulkCreate
        try {
          const bulkVariantsInput = specs.map((spec) => ({
            price: primaryPrice,
            inventoryPolicy: "DENY",
            optionValues: [
              {
                optionName,
                name: spec.optionValue,
              },
            ],
            inventoryItem: {
              sku: spec.canonicalSku,
              tracked: true,
            },
            metafields: [
              {
                namespace: "trends",
                key: "stock_code",
                type: "single_line_text_field",
                value: spec.stockCode,
              },
            ],
          }));

          const bulkRes = await admin.graphql(
            `#graphql
            mutation bulkCreateVariants(
              $productId: ID!
              $variants: [ProductVariantsBulkInput!]!
              $strategy: ProductVariantsBulkCreateStrategy
            ) {
              productVariantsBulkCreate(
                productId: $productId
                variants: $variants
                strategy: $strategy
              ) {
                productVariants {
                  id
                  title
                  price
                  inventoryQuantity
                  availableForSale
                  inventoryPolicy
                  inventoryItem {
                    id
                    sku
                    tracked
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                productId: shopifyProductId,
                strategy: "REMOVE_STANDALONE_VARIANT",
                variants: bulkVariantsInput,
              },
            }
          );

          const bulkJson = await bulkRes.json();
          const createdVariants = bulkJson?.data?.productVariantsBulkCreate?.productVariants || [];
          const bulkErrors = bulkJson?.data?.productVariantsBulkCreate?.userErrors || [];

          if (bulkErrors.length > 0) {
            console.warn(
              "[Shopify Sync] productVariantsBulkCreate user errors:",
              bulkErrors.map((e: { message: string }) => e.message).join(", ")
            );
          }

          // Map each spec to created variant GID
          for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            const matched =
              createdVariants.find((cv: any) => cv.inventoryItem?.sku === spec.canonicalSku) ||
              createdVariants[i];

            const varId = matched?.id || `${shopifyProductId}/variant/${spec.stockCode}`;
            variantLedgerEntries.push({
              shopifyVariantId: varId,
              inventoryItemId: matched?.inventoryItem?.id,
              stockCode: spec.stockCode,
              quantity: spec.quantity,
            });
          }

          // Multi-location inventory adjustment for bulk variants
          if (primaryLocationId && createdVariants.length > 0) {
            const inventoryItemsToSync: InventorySyncItem[] = [];
            for (let i = 0; i < specs.length; i++) {
              const spec = specs[i];
              const matched =
                createdVariants.find((cv: any) => cv.inventoryItem?.sku === spec.canonicalSku) ||
                createdVariants[i];
              if (matched?.inventoryItem?.id) {
                const allocations = allocateStockAcrossLocations(
                  spec.quantity,
                  effectiveMode,
                  effectiveTargetLocationId,
                  effectiveSplitLocationIds,
                  primaryLocationId
                );
                for (const alloc of allocations) {
                  inventoryItemsToSync.push({
                    inventoryItemId: matched.inventoryItem.id,
                    quantity: alloc.quantity,
                    locationId: alloc.locationId,
                    sku: spec.canonicalSku,
                  });
                }
              }
            }

            if (inventoryItemsToSync.length > 0) {
              await syncInventoryQuantities(admin, primaryLocationId, inventoryItemsToSync);
            }
          }
        } catch (bulkErr) {
          console.warn("[Shopify Sync] Bulk variant creation error:", bulkErr);
          // Fallback to tracking specs
          for (const spec of specs) {
            variantLedgerEntries.push({
              shopifyVariantId: `${shopifyProductId}/variant/${spec.stockCode}`,
              stockCode: spec.stockCode,
              quantity: spec.quantity,
            });
          }
        }
      }
    } else {
      // --- UPDATE EXISTING PRODUCT ---
      // Respect merchant syncLocks
      const updateInput: Record<string, unknown> = {
        id: shopifyProductId,
        metafields,
        tags: [
          "supplier:trends",
          `trends_code:${trendsCode}`,
          `region:${normalizedRegion}`,
          ...(trendsProduct.categories?.map((c) => c.name) || []),
          ...(isMockProduct ? ["trends:mock"] : []),
        ],
      };

      if (!syncLocks.includes("title")) {
        updateInput.title = trendsProduct.name;
      }

      if (!syncLocks.includes("description")) {
        updateInput.descriptionHtml = buildDescriptionHtml(trendsProduct);
      }

      const updateRes = await admin.graphql(
        `#graphql
        mutation productUpdate($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              handle
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            product: updateInput,
          },
        }
      );

      const updateJson = await updateRes.json();
      const updatedProduct = updateJson?.data?.productUpdate?.product;
      if (updatedProduct?.handle) {
        shopifyHandle = updatedProduct.handle;
      }

      // Synchronize existing variant prices if not locked
      try {
        const varQueryRes = await admin.graphql(
          `#graphql
          query getProductVariants($id: ID!) {
            product(id: $id) {
              totalInventory
              variants(first: 50) {
                nodes {
                  id
                  sku
                  inventoryQuantity
                  availableForSale
                  inventoryPolicy
                  inventoryItem {
                    id
                    sku
                    tracked
                  }
                }
              }
            }
          }`,
          {
            variables: { id: shopifyProductId },
          }
        );
        const varQueryJson = await varQueryRes.json();
        const existingNodes = varQueryJson?.data?.product?.variants?.nodes || [];

        const updatePayload = [];
        for (const spec of specs) {
          const matchedNode = existingNodes.find(
            (n: any) => n.inventoryItem?.sku === spec.canonicalSku || n.sku === spec.canonicalSku
          );
          if (matchedNode?.id) {
            variantLedgerEntries.push({
              shopifyVariantId: matchedNode.id,
              inventoryItemId: matchedNode.inventoryItem?.id,
              stockCode: spec.stockCode,
              quantity: spec.quantity,
            });
            const varUpdate: Record<string, unknown> = {
              id: matchedNode.id,
              inventoryPolicy: "DENY",
              inventoryItem: {
                sku: spec.canonicalSku,
                tracked: true,
              },
            };
            if (!syncLocks.includes("price")) {
              varUpdate.price = primaryPrice;
            }
            updatePayload.push(varUpdate);
          } else {
            variantLedgerEntries.push({
              shopifyVariantId: `${shopifyProductId}/variant/${spec.stockCode}`,
              stockCode: spec.stockCode,
              quantity: spec.quantity,
            });
          }
        }

        if (updatePayload.length > 0) {
          await admin.graphql(
            `#graphql
            mutation updateExistingVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants {
                  id
                  price
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                productId: shopifyProductId,
                variants: updatePayload,
              },
            }
          );
        }

        // Synchronize inventory quantities for existing variants across configured locations
        if (primaryLocationId && !syncLocks.includes("inventory")) {
          const inventoryItemsToUpdate: InventorySyncItem[] = [];
          for (const spec of specs) {
            const matchedNode = existingNodes.find(
              (n: any) => n.inventoryItem?.sku === spec.canonicalSku || n.sku === spec.canonicalSku
            );
            if (matchedNode?.inventoryItem?.id) {
              const allocations = allocateStockAcrossLocations(
                spec.quantity,
                effectiveMode,
                effectiveTargetLocationId,
                effectiveSplitLocationIds,
                primaryLocationId
              );
              for (const alloc of allocations) {
                inventoryItemsToUpdate.push({
                  inventoryItemId: matchedNode.inventoryItem.id,
                  quantity: alloc.quantity,
                  locationId: alloc.locationId,
                  sku: spec.canonicalSku,
                });
              }
            }
          }

          if (inventoryItemsToUpdate.length > 0) {
            await syncInventoryQuantities(admin, primaryLocationId, inventoryItemsToUpdate);
          }
        }
      } catch (varUpdateErr) {
        console.warn("[Shopify Sync] Could not refresh existing variants:", varUpdateErr);
      }
    }

    // --- VARIANT MEDIA & IMAGE ATTACHMENT PIPELINE ---
    if (
      shopifyProductId &&
      trendsProduct.images &&
      trendsProduct.images.length > 0
    ) {
      try {
        const variantImageExtraction = extractVariantImageMappings(trendsProduct, specs);
        const mediaResult = await syncProductMedia(
          admin,
          shopifyProductId,
          trendsProduct,
          variantImageExtraction.mappings
        );
        await assignVariantMedia(
          admin,
          shopifyProductId,
          variantLedgerEntries,
          specs,
          variantImageExtraction.mappings,
          mediaResult,
          trendsProduct.name
        );
      } catch (mediaPipelineErr) {
        console.warn("[Shopify Sync] Variant media pipeline warning (non-fatal):", mediaPipelineErr);
      }
    }
  }

  // Ensure deterministic product ID is present
  const resolvedShopifyProductId: string =
    shopifyProductId || `gid://shopify/Product/mock-${trendsCode}`;
  const resolvedShopifyHandle: string =
    shopifyHandle || `trends-${trendsCode}`;

  // Ensure fallback variant ledger entries if offline or mock
  if (variantLedgerEntries.length === 0) {
    for (const spec of specs) {
      variantLedgerEntries.push({
        shopifyVariantId: `${resolvedShopifyProductId}/variant/${spec.stockCode}`,
        stockCode: spec.stockCode,
        quantity: spec.quantity,
      });
    }
  }

  // 4. Persist record in PostgreSQL Sync Ledger
  const action: "created" | "updated" = existingSync ? "updated" : "created";

  const savedSync = await prisma.trendProductSync.upsert({
    where: {
      shopifyProductId: resolvedShopifyProductId,
    },
    create: {
      shop,
      shopifyProductId: resolvedShopifyProductId,
      trendsCode,
      region: normalizedRegion,
      syncLocks,
      lastSyncedAt: new Date(),
      ...(explicitMode !== undefined ? { inventorySyncMode: explicitMode } : {}),
      ...(explicitTargetLoc !== undefined ? { targetLocationId: explicitTargetLoc } : {}),
      ...(explicitSplitLocs !== undefined ? { splitLocationIds: explicitSplitLocs } : {}),
    },
    update: {
      region: normalizedRegion,
      syncLocks,
      lastSyncedAt: new Date(),
      ...(explicitMode !== undefined ? { inventorySyncMode: explicitMode } : {}),
      ...(explicitTargetLoc !== undefined ? { targetLocationId: explicitTargetLoc } : {}),
      ...(explicitSplitLocs !== undefined ? { splitLocationIds: explicitSplitLocs } : {}),
    },
  });

  // Track all variants in Prisma
  for (const vEntry of variantLedgerEntries) {
    await prisma.trendVariantSync.upsert({
      where: {
        shopifyVariantId: vEntry.shopifyVariantId,
      },
      create: {
        productSyncId: savedSync.id,
        shopifyVariantId: vEntry.shopifyVariantId,
        inventoryItemId: vEntry.inventoryItemId || null,
        stockCode: vEntry.stockCode,
        region: normalizedRegion,
        lastStockQty: vEntry.quantity,
      },
      update: {
        ...(vEntry.inventoryItemId ? { inventoryItemId: vEntry.inventoryItemId } : {}),
        stockCode: vEntry.stockCode,
        region: normalizedRegion,
        lastStockQty: vEntry.quantity,
      },
    });
  }

  return {
    success: true,
    action,
    shopifyProductId: resolvedShopifyProductId,
    shopifyHandle: resolvedShopifyHandle,
    skuList,
    message: `Product ${trendsCode} successfully ${action} in Shopify (${skuList.length} variants synced).`,
    isMock: isMockProduct,
  };
}

/**
 * Permanently removes a product from Shopify Admin and the local PostgreSQL sync ledger.
 * Cascade-deletes linked variants from TrendVariantSync.
 */
export async function deleteTrendProductFromShopify({
  admin,
  shop,
  trendsCode,
}: DeleteTrendProductOptions): Promise<DeleteTrendProductResult> {
  const codeStr = String(trendsCode);

  // 1. Locate record in PostgreSQL sync ledger
  const existingSync = await prisma.trendProductSync.findFirst({
    where: {
      shop,
      trendsCode: codeStr,
    },
  });

  const shopifyProductId = existingSync?.shopifyProductId;

  // 2. If present in Shopify Admin and is a real GID, delete from Shopify store
  if (admin && shopifyProductId && !shopifyProductId.includes("mock-")) {
    try {
      const deleteRes = await admin.graphql(
        `#graphql
        mutation productDelete($input: ProductDeleteInput!) {
          productDelete(input: $input) {
            deletedProductId
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: {
              id: shopifyProductId,
            },
          },
        }
      );

      const deleteJson = await deleteRes.json();
      const userErrors = deleteJson?.data?.productDelete?.userErrors || [];
      if (userErrors.length > 0) {
        console.warn("[Shopify Sync] productDelete user errors:", userErrors);
      }
    } catch (err: unknown) {
      console.warn("[Shopify Sync] Could not delete product from Shopify Admin:", err);
    }
  }

  // 3. Remove from PostgreSQL Sync Ledger (Cascade deletes variants in TrendVariantSync)
  if (existingSync) {
    await prisma.trendProductSync.delete({
      where: {
        id: existingSync.id,
      },
    });
  }

  return {
    success: true,
    trendsCode: codeStr,
    shopifyProductId,
    message: `Product ${codeStr} successfully removed from Shopify and local sync ledger.`,
  };
}

/**
 * Retrieves the sync status map for a list of TRENDS product codes.
 */
export async function getTrendProductSyncStatuses(
  shop: string,
  trendsCodes?: string[]
): Promise<Record<string, SyncStatusItem>> {
  const whereClause: any = { shop };
  if (trendsCodes && trendsCodes.length > 0) {
    whereClause.trendsCode = { in: trendsCodes.map(String) };
  }

  const syncRecords = await prisma.trendProductSync.findMany({
    where: whereClause,
    include: {
      variants: true,
    },
  });

  const map: Record<string, SyncStatusItem> = {};
  for (const record of syncRecords) {
    const numericId = record.shopifyProductId.split("/").pop();
    map[record.trendsCode] = {
      isSynced: true,
      shopifyProductId: record.shopifyProductId,
      shopifyNumericId: numericId,
      lastSyncedAt: record.lastSyncedAt.toISOString(),
      region: record.region,
      variantCount: record.variants.length,
    };
  }

  return map;
}
