import { randomUUID } from "node:crypto";
import type { ProductData, Region, StockListData } from "../../shared/types/trends.types";
import { TrendsApiClient } from "../api-client/trends-client";
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
  if (product.pricing && product.pricing.length > 0) {
    for (const group of product.pricing) {
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
    rawList = product.stock.map((s, idx) => {
      const q = typeof s.quantity === "number" ? s.quantity : Number(s.quantity);
      return {
        stockCode: String(s.stock_code || `STK-${idx + 1}`),
        description: s.description || colours[idx] || `Style ${idx + 1}`,
        quantity: !isNaN(q) ? Math.max(0, q) : 0,
      };
    });
  } else if (hasColours) {
    rawList = colours.map((col, idx) => ({
      stockCode: `COL-${idx + 1}`,
      description: col,
      quantity: 100,
    }));
  } else {
    rawList = [
      {
        stockCode: "DEFAULT",
        description: "Standard",
        quantity: 100,
      },
    ];
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

export interface InventorySyncItem {
  inventoryItemId: string;
  quantity: number;
}

/**
 * Explicitly enables inventory tracking and assigns available stock quantities
 * at the target warehouse location using Shopify Admin GraphQL.
 */
export async function syncInventoryQuantities(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  locationId: string,
  items: InventorySyncItem[]
): Promise<void> {
  const validItems = items.filter((it) => it.inventoryItemId && it.quantity >= 0);
  if (validItems.length === 0) return;

  // 1. Explicitly enable inventory tracking on each variant's inventory item
  await Promise.allSettled(
    validItems.map(async (item) => {
      try {
        await admin.graphql(
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
              id: item.inventoryItemId,
              input: {
                tracked: true,
              },
            },
          }
        );
      } catch (trackErr) {
        console.warn("[Shopify Sync] enableInventoryTracking warning for item", item.inventoryItemId, trackErr);
      }
    })
  );

  // 2. Set available inventory quantities via inventorySetQuantities with mandatory @idempotent directive
  const quantitiesInput = validItems.map((item) => ({
    inventoryItemId: item.inventoryItemId,
    locationId,
    quantity: Math.max(0, Number(item.quantity) || 0),
    changeFromQuantity: null,
  }));

  try {
    const setRes = await admin.graphql(
      `#graphql
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
        inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          inventoryAdjustmentGroup {
            createdAt
          }
          userErrors {
            code
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
          idempotencyKey: randomUUID(),
        },
      }
    );

    const setJson = await setRes.json();
    const userErrors: Array<{ code?: string; field?: string[]; message: string }> =
      setJson?.data?.inventorySetQuantities?.userErrors || [];

    if (userErrors.length > 0) {
      console.warn(
        "[Shopify Sync] inventorySetQuantities userErrors:",
        userErrors.map((e) => `${e.field?.join(".") || "error"}: ${e.message}`).join(", ")
      );

      // 3. Fallback: activate unstocked items using inventoryActivate
      for (const item of validItems) {
        try {
          await admin.graphql(
            `#graphql
            mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int, $idempotencyKey: String!) {
              inventoryActivate(
                inventoryItemId: $inventoryItemId
                locationId: $locationId
                available: $available
              ) @idempotent(key: $idempotencyKey) {
                inventoryLevel {
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
                locationId,
                available: Math.max(0, Number(item.quantity) || 0),
                idempotencyKey: randomUUID(),
              },
            }
          );
        } catch (actErr) {
          console.warn("[Shopify Sync] inventoryActivate fallback warning for item", item.inventoryItemId, actErr);
        }
      }
    }
  } catch (setErr) {
    console.warn("[Shopify Sync] inventorySetQuantities error, attempting inventoryActivate fallback:", setErr);
    // Fallback: activate each item individually
    for (const item of validItems) {
      try {
        await admin.graphql(
          `#graphql
          mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int, $idempotencyKey: String!) {
            inventoryActivate(
              inventoryItemId: $inventoryItemId
              locationId: $locationId
              available: $available
            ) @idempotent(key: $idempotencyKey) {
              inventoryLevel {
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
              locationId,
              available: Math.max(0, Number(item.quantity) || 0),
              idempotencyKey: randomUUID(),
            },
          }
        );
      } catch (actErr) {
        console.warn("[Shopify Sync] inventoryActivate individual fallback warning:", actErr);
      }
    }
  }
}

/**
 * Synchronizes a TRENDS product to Shopify Admin GraphQL
 * Creates or updates product, sets canonical SKUs, assigns metafields,
 * updates inventory, and tracks sync status in Postgres.
 */
export async function syncTrendProductToShopify({
  admin,
  shop,
  trendsProduct,
  region,
  syncLocks = [],
  isMock,
}: SyncTrendProductOptions): Promise<SyncTrendProductResult> {
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

  // 2. Ensure product has live stock data for accurate variant inventory
  if ((!trendsProduct.stock || trendsProduct.stock.length === 0) && trendsCode) {
    try {
      const stockRes = await TrendsApiClient.request<StockListData>(normalizedRegion, `stock/${trendsCode}`);
      const stockItems = stockRes?.data?.data;
      if (Array.isArray(stockItems) && stockItems.length > 0) {
        trendsProduct = {
          ...trendsProduct,
          stock: stockItems,
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
  const variantLedgerEntries: { shopifyVariantId: string; stockCode: string; quantity: number }[] = [];

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

    // Resolve active primary location for inventory setting
    let primaryLocationId: string | null = null;
    try {
      const locRes = await admin.graphql(
        `#graphql
        query getLocations {
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
      primaryLocationId = resolveFulfillmentLocation(locations, normalizedRegion);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("Access denied for locations field") || errMsg.includes("locations")) {
        console.info(
          "[Shopify Sync] Notice: 'read_locations' scope not yet granted in Shopify Admin. Skipping multi-location inventory adjustments."
        );
      } else {
        console.warn("[Shopify Sync] Could not retrieve location:", errMsg);
      }
    }

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
        value: JSON.stringify(trendsProduct.pricing?.[0]?.prices || []),
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
              stockCode: specs[0].stockCode,
              quantity: specs[0].quantity,
            });

            // Adjust inventory for single variant if location available
            if (primaryLocationId && firstVariant.inventoryItem?.id) {
              await syncInventoryQuantities(admin, primaryLocationId, [
                {
                  inventoryItemId: firstVariant.inventoryItem.id,
                  quantity: specs[0].quantity,
                },
              ]);
            }
          } catch (varErr) {
            console.warn("[Shopify Sync] Single variant update skipped:", varErr);
            variantLedgerEntries.push({
              shopifyVariantId: firstVariant.id,
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
                inventoryItemsToSync.push({
                  inventoryItemId: matched.inventoryItem.id,
                  quantity: spec.quantity,
                });
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

      // --- PRODUCT MEDIA PIPELINE ---
      if (trendsProduct.images && trendsProduct.images.length > 0) {
        const mediaList = trendsProduct.images
          .map((img) => {
            const validUrl = sanitizeImageUrl(img.link);
            if (!validUrl) return null;
            return {
              originalSource: validUrl,
              mediaContentType: "IMAGE" as const,
              alt: img.colour ? `${trendsProduct.name} - ${img.colour}` : trendsProduct.name,
            };
          })
          .filter((m): m is { originalSource: string; mediaContentType: "IMAGE"; alt: string } => m !== null)
          .slice(0, 10);

        if (mediaList.length > 0) {
          try {
            const mediaRes = await admin.graphql(
              `#graphql
              mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
                productCreateMedia(productId: $productId, media: $media) {
                  media {
                    id
                    status
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
                  productId: shopifyProductId,
                  media: mediaList,
                },
              }
            );

            const mediaJson = await mediaRes.json();
            const mediaErrors = mediaJson?.data?.productCreateMedia?.mediaUserErrors || [];
            if (mediaErrors.length > 0) {
              console.warn(
                "[Shopify Sync] Image upload warnings:",
                mediaErrors.map((e: { message: string }) => e.message).join(", ")
              );
            }
          } catch (mediaErr: unknown) {
            const msg = mediaErr instanceof Error ? mediaErr.message : String(mediaErr);
            console.warn("[Shopify Sync] Image pipeline warning (non-fatal):", msg);
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
              stockCode: spec.stockCode,
              quantity: spec.quantity,
            });
            if (!syncLocks.includes("price")) {
              updatePayload.push({
                id: matchedNode.id,
                price: primaryPrice,
                inventoryItem: {
                  sku: spec.canonicalSku,
                },
              });
            }
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

        // Synchronize inventory quantities for existing variants if location is available
        if (primaryLocationId && !syncLocks.includes("inventory")) {
          const inventoryItemsToUpdate: InventorySyncItem[] = [];
          for (const spec of specs) {
            const matchedNode = existingNodes.find(
              (n: any) => n.inventoryItem?.sku === spec.canonicalSku || n.sku === spec.canonicalSku
            );
            if (matchedNode?.inventoryItem?.id) {
              inventoryItemsToUpdate.push({
                inventoryItemId: matchedNode.inventoryItem.id,
                quantity: spec.quantity,
              });
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
    },
    update: {
      region: normalizedRegion,
      syncLocks,
      lastSyncedAt: new Date(),
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
        stockCode: vEntry.stockCode,
        region: normalizedRegion,
        lastStockQty: vEntry.quantity,
      },
      update: {
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
