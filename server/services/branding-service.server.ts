/**
 * Database-free branding service mapping. Two hidden (unlisted) products in
 * Shopify are the source of truth:
 *   - "Custom Branding": one per-unit run-charge variant per branding method
 *   - "Setup Charge": one one-time setup-fee variant per branding method
 * Each synced product carries a `branding.options` JSON metafield linking
 * every method's run-charge variant to its setup-fee variant. Nothing here is
 * stored in Postgres — the TrendProductSync table is only read to know which
 * Shopify products to stamp.
 */
import prisma from "../../app/db.server";
import { normalizePricing } from "../../shared/types/trends.types";

type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export const BRANDING_METAFIELD_NAMESPACE = "branding";
export const BRANDING_METAFIELD_KEY = "options";

/** The earlier single combined service product — only looked up to warn that it's no longer used. */
const LEGACY_COMBINED_HANDLE = "custom-branding-service";
const METAFIELDS_SET_BATCH_SIZE = 25;

export type BrandingMethod = "screen_print" | "embroidery";
export type BrandingFeeType = "PER_COLOUR" | "PER_POSITION";
type ChargeKind = "run" | "setup";

/** One entry of the `branding.options` metafield array. */
export interface BrandingOption {
  method_id: BrandingMethod;
  name: string;
  /** "Custom Branding" product variant — quantity = product qty × multiplier. */
  branding_variant_id: string;
  unit_run_charge: number;
  /** "Setup Charge" product variant — quantity = multiplier. */
  setup_variant_id: string;
  setup_cost: number;
  fee_type: BrandingFeeType;
}

interface BrandingMethodSpec {
  method: BrandingMethod;
  label: string;
  feeType: BrandingFeeType;
  defaultSetupPrice: string;
  defaultRunPrice: string;
  /**
   * Trends `print_type` names (normalized) this method covers. Matched
   * exactly, never by substring: "Faux Embroidery" is a printed imitation and
   * must not pick up real Embroidery. "Rotary Screen Print" is screen
   * printing on round items (Trends prices it as "Screen Print Per Colour").
   */
  supplierNames: string[];
}

const BRANDING_METHODS: BrandingMethodSpec[] = [
  {
    method: "screen_print",
    label: "Screen Print",
    feeType: "PER_COLOUR",
    defaultSetupPrice: "40.00",
    defaultRunPrice: "0.40",
    supplierNames: ["screen print", "rotary screen print"],
  },
  {
    method: "embroidery",
    label: "Embroidery",
    feeType: "PER_POSITION",
    defaultSetupPrice: "50.00",
    defaultRunPrice: "0.75",
    supplierNames: ["embroidery"],
  },
];

/** "Rotary  Screen-Print" → "rotary screen print". */
function normalizeMethodName(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The decoration methods a Trends product actually offers, normalized: its
 * `branding_options[].print_type` list, plus any `branding_option` named on
 * its pricing `additional_costs[]`.
 */
export function extractSupportedMethodNames(product: {
  branding_options?: Array<{ print_type?: string }> | null;
  pricing?: unknown;
}): string[] {
  const names = new Set<string>();
  for (const option of product.branding_options ?? []) {
    const name = normalizeMethodName(option?.print_type);
    if (name) names.add(name);
  }
  for (const group of normalizePricing(product.pricing)) {
    for (const cost of group.additional_costs ?? []) {
      const name = normalizeMethodName(cost.branding_option);
      if (name) names.add(name);
    }
  }
  return [...names];
}

/** Only the master options whose method the product supports; [] when it supports none. */
export function filterBrandingOptionsForProduct(
  options: BrandingOption[],
  supportedMethodNames: string[]
): BrandingOption[] {
  const supported = new Set(supportedMethodNames.map(normalizeMethodName));
  return options.filter((option) => {
    const spec = BRANDING_METHODS.find((m) => m.method === option.method_id);
    return Boolean(spec?.supplierNames.some((name) => supported.has(name)));
  });
}

interface ServiceProductSpec {
  charge: ChargeKind;
  title: string;
  handle: string;
  tag: string;
  optionName: string;
}

export const SERVICE_PRODUCTS: Record<ChargeKind, ServiceProductSpec> = {
  run: {
    charge: "run",
    title: "Custom Branding",
    handle: "custom-branding",
    tag: "_branding_run_charge_hidden",
    optionName: "Branding Method",
  },
  setup: {
    charge: "setup",
    title: "Setup Charge",
    handle: "branding-setup-charge",
    tag: "_branding_setup_charge_hidden",
    optionName: "Setup",
  },
};

interface ServiceVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
}

interface ServiceProduct {
  id: string;
  handle: string;
  variants: { nodes: ServiceVariant[] };
}

interface ServiceProducts {
  run: ServiceProduct | null;
  setup: ServiceProduct | null;
  legacyCombinedId: string | null;
}

const variantTitle = (spec: BrandingMethodSpec, charge: ChargeKind) =>
  charge === "run" ? spec.label : `${spec.label} Setup`;

const variantSku = (spec: BrandingMethodSpec, charge: ChargeKind) =>
  `BRANDING-${spec.method.toUpperCase()}-${charge.toUpperCase()}`;

class BrandingServiceError extends Error {}

async function brandingGraphql<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new BrandingServiceError(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new BrandingServiceError("Shopify returned no data.");
  return json.data;
}

const userErrorText = (errors: Array<{ field?: string[] | null; message: string }>) =>
  errors.map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message)).join("; ");

const SERVICE_PRODUCT_FIELDS = `#graphql
  fragment BrandingServiceProduct on Product {
    id
    handle
    variants(first: 50) {
      nodes {
        id
        title
        sku
        price
      }
    }
  }
`;

/** Both service products (each by handle, then by tag) in one request. */
export async function findServiceProducts(admin: AdminGraphqlClient): Promise<ServiceProducts> {
  const data = await brandingGraphql<{
    runByHandle: ServiceProduct | null;
    runByTag: { nodes: ServiceProduct[] };
    setupByHandle: ServiceProduct | null;
    setupByTag: { nodes: ServiceProduct[] };
    legacy: { id: string } | null;
  }>(
    admin,
    `#graphql
    query findBrandingServiceProducts(
      $runHandle: ProductIdentifierInput!
      $runTag: String!
      $setupHandle: ProductIdentifierInput!
      $setupTag: String!
      $legacyHandle: ProductIdentifierInput!
    ) {
      runByHandle: productByIdentifier(identifier: $runHandle) {
        ...BrandingServiceProduct
      }
      runByTag: products(first: 1, query: $runTag) {
        nodes {
          ...BrandingServiceProduct
        }
      }
      setupByHandle: productByIdentifier(identifier: $setupHandle) {
        ...BrandingServiceProduct
      }
      setupByTag: products(first: 1, query: $setupTag) {
        nodes {
          ...BrandingServiceProduct
        }
      }
      legacy: productByIdentifier(identifier: $legacyHandle) {
        id
      }
    }
    ${SERVICE_PRODUCT_FIELDS}`,
    {
      runHandle: { handle: SERVICE_PRODUCTS.run.handle },
      runTag: `tag:'${SERVICE_PRODUCTS.run.tag}'`,
      setupHandle: { handle: SERVICE_PRODUCTS.setup.handle },
      setupTag: `tag:'${SERVICE_PRODUCTS.setup.tag}'`,
      legacyHandle: { handle: LEGACY_COMBINED_HANDLE },
    }
  );
  return {
    run: data.runByHandle ?? data.runByTag.nodes[0] ?? null,
    setup: data.setupByHandle ?? data.setupByTag.nodes[0] ?? null,
    legacyCombinedId: data.legacy?.id ?? null,
  };
}

/**
 * Which method a service variant charges for: our own SKU first (stable even
 * if the merchant renames a variant), else the method name in its title.
 */
function methodForVariant(variant: ServiceVariant, charge: ChargeKind): BrandingMethodSpec | null {
  const sku = (variant.sku || "").toUpperCase();
  const title = variant.title.toLowerCase();
  return (
    BRANDING_METHODS.find((spec) => sku === variantSku(spec, charge)) ??
    BRANDING_METHODS.find((spec) => title.includes(spec.label.toLowerCase())) ??
    null
  );
}

function variantsByMethod(product: ServiceProduct, charge: ChargeKind) {
  const byMethod = new Map<BrandingMethod, ServiceVariant>();
  for (const variant of product.variants.nodes) {
    const spec = methodForVariant(variant, charge);
    if (spec && !byMethod.has(spec.method)) byMethod.set(spec.method, variant);
  }
  return byMethod;
}

/**
 * Links each method's "Custom Branding" run-charge variant to its "Setup
 * Charge" variant. Only methods present in BOTH products are emitted.
 */
export function buildBrandingOptions(products: Pick<ServiceProducts, "run" | "setup">): BrandingOption[] {
  if (!products.run || !products.setup) return [];
  const runVariants = variantsByMethod(products.run, "run");
  const setupVariants = variantsByMethod(products.setup, "setup");

  const options: BrandingOption[] = [];
  for (const spec of BRANDING_METHODS) {
    const run = runVariants.get(spec.method);
    const setup = setupVariants.get(spec.method);
    if (!run || !setup) continue;
    options.push({
      method_id: spec.method,
      name: spec.label,
      branding_variant_id: run.id,
      unit_run_charge: Number(run.price) || 0,
      setup_variant_id: setup.id,
      setup_cost: Number(setup.price) || 0,
      fee_type: spec.feeType,
    });
  }
  return options;
}

async function createServiceProduct(admin: AdminGraphqlClient, spec: ServiceProductSpec): Promise<ServiceProduct> {
  const data = await brandingGraphql<{
    productSet: {
      product: ServiceProduct | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(
    admin,
    `#graphql
    mutation createBrandingServiceProduct($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product {
          ...BrandingServiceProduct
        }
        userErrors {
          field
          message
          code
        }
      }
    }
    ${SERVICE_PRODUCT_FIELDS}`,
    {
      input: {
        title: spec.title,
        handle: spec.handle,
        productType: "Digital Service",
        // UNLISTED = active and purchasable, but hidden from search,
        // collections and recommendations.
        status: "UNLISTED",
        tags: [spec.tag],
        productOptions: [
          {
            name: spec.optionName,
            values: BRANDING_METHODS.map((method) => ({ name: variantTitle(method, spec.charge) })),
          },
        ],
        variants: BRANDING_METHODS.map((method) => ({
          optionValues: [{ optionName: spec.optionName, name: variantTitle(method, spec.charge) }],
          price: spec.charge === "run" ? method.defaultRunPrice : method.defaultSetupPrice,
          sku: variantSku(method, spec.charge),
          inventoryPolicy: "CONTINUE",
          inventoryItem: { requiresShipping: false, tracked: false },
        })),
      },
    }
  );

  const { product, userErrors } = data.productSet;
  if (userErrors.length || !product) {
    throw new BrandingServiceError(
      `Could not create the "${spec.title}" product: ${userErrorText(userErrors) || "no product returned"}`
    );
  }
  return product;
}

/**
 * Publishes to the Online Store channel only — the storefront's /cart/add.js
 * needs that, and any other channel (Shop app, Google, POS…) would surface a
 * fee-only product as something to buy on its own.
 */
async function publishToOnlineStore(admin: AdminGraphqlClient, productId: string): Promise<string | null> {
  const data = await brandingGraphql<{
    publications: { nodes: Array<{ id: string; catalog: { title: string } | null }> };
  }>(
    admin,
    `#graphql
    query brandingServicePublications {
      publications(first: 50) {
        nodes {
          id
          catalog {
            title
          }
        }
      }
    }`
  );
  const onlineStore = data.publications.nodes.find((p) => /online store/i.test(p.catalog?.title || ""));
  if (!onlineStore) {
    return "No Online Store sales channel was found — publish the branding service product to it manually.";
  }

  const result = await brandingGraphql<{
    publishablePublish: { userErrors: Array<{ field?: string[] | null; message: string }> };
  }>(
    admin,
    `#graphql
    mutation publishBrandingServiceProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors {
          field
          message
        }
      }
    }`,
    { id: productId, input: [{ publicationId: onlineStore.id }] }
  );
  const errors = result.publishablePublish.userErrors;
  return errors.length ? `Online Store publishing failed: ${userErrorText(errors)}` : null;
}

/**
 * Creates `branding.options` (PRODUCT, json) with Storefront API read access,
 * or — if a definition already exists, e.g. one a merchant made by hand —
 * makes sure its storefront access is PUBLIC_READ. Liquid can read product
 * metafields either way; this is what exposes them to the Storefront API.
 */
export async function ensureBrandingMetafieldDefinition(admin: AdminGraphqlClient): Promise<void> {
  const created = await brandingGraphql<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string } | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>(
    admin,
    `#graphql
    mutation createBrandingOptionsDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    {
      definition: {
        name: "Branding options",
        description: "Branding methods and their setup/run-charge service variants. Managed by TRENDS API.",
        namespace: BRANDING_METAFIELD_NAMESPACE,
        key: BRANDING_METAFIELD_KEY,
        type: "json",
        ownerType: "PRODUCT",
        access: { storefront: "PUBLIC_READ" },
      },
    }
  );

  const createErrors = created.metafieldDefinitionCreate.userErrors;
  if (createErrors.length === 0) return;
  if (!createErrors.every((e) => e.code === "TAKEN")) {
    throw new BrandingServiceError(`Could not create the branding.options definition: ${userErrorText(createErrors)}`);
  }

  const updated = await brandingGraphql<{
    metafieldDefinitionUpdate: { userErrors: Array<{ field?: string[] | null; message: string }> };
  }>(
    admin,
    `#graphql
    mutation updateBrandingOptionsDefinition($definition: MetafieldDefinitionUpdateInput!) {
      metafieldDefinitionUpdate(definition: $definition) {
        updatedDefinition {
          id
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    {
      definition: {
        namespace: BRANDING_METAFIELD_NAMESPACE,
        key: BRANDING_METAFIELD_KEY,
        ownerType: "PRODUCT",
        access: { storefront: "PUBLIC_READ" },
      },
    }
  );
  const updateErrors = updated.metafieldDefinitionUpdate.userErrors;
  if (updateErrors.length) {
    throw new BrandingServiceError(
      `Could not enable storefront access on branding.options: ${userErrorText(updateErrors)}`
    );
  }
}

// Short-lived per-shop cache so a catalog-wide sync (one call per product)
// doesn't re-query the service products every time.
const BRANDING_OPTIONS_CACHE_TTL_MS = 60_000;
const brandingOptionsCache = new Map<string, { options: BrandingOption[]; at: number }>();

export interface InitializeBrandingServiceResult {
  brandingProductId: string;
  setupProductId: string;
  created: Record<ChargeKind, boolean>;
  options: BrandingOption[];
  warnings: string[];
}

/** Settings "Initialize / Connect Branding Service" action. Safe to run repeatedly. */
export async function initializeBrandingService(
  admin: AdminGraphqlClient,
  shop: string
): Promise<InitializeBrandingServiceResult> {
  const found = await findServiceProducts(admin);
  const warnings: string[] = [];
  const created: Record<ChargeKind, boolean> = { run: false, setup: false };
  const products: Record<ChargeKind, ServiceProduct | null> = { run: found.run, setup: found.setup };

  for (const charge of ["run", "setup"] as const) {
    if (products[charge]) continue;
    const product = await createServiceProduct(admin, SERVICE_PRODUCTS[charge]);
    products[charge] = product;
    created[charge] = true;
    const publishWarning = await publishToOnlineStore(admin, product.id);
    if (publishWarning) warnings.push(`${SERVICE_PRODUCTS[charge].title}: ${publishWarning}`);
  }
  const run = products.run as ServiceProduct;
  const setup = products.setup as ServiceProduct;

  await ensureBrandingMetafieldDefinition(admin);

  const options = buildBrandingOptions({ run, setup });
  if (options.length === 0) {
    warnings.push(
      `No branding method has a variant in both "${run.handle}" and "${setup.handle}" — expected matching ` +
        `variants like "Screen Print" and "Screen Print Setup".`
    );
  }
  if (found.legacyCombinedId) {
    warnings.push(
      `The old combined "${LEGACY_COMBINED_HANDLE}" product is no longer used. Re-run Bulk Sync, then archive it in Shopify.`
    );
  }
  brandingOptionsCache.set(shop, { options, at: Date.now() });

  return { brandingProductId: run.id, setupProductId: setup.id, created, options, warnings };
}

/**
 * Current branding options for the shop, or [] if the service products
 * haven't been initialized (or can't be read). Never throws — product sync
 * must not fail over branding.
 */
export async function fetchBrandingOptions(admin: AdminGraphqlClient, shop: string): Promise<BrandingOption[]> {
  const cached = brandingOptionsCache.get(shop);
  if (cached && Date.now() - cached.at < BRANDING_OPTIONS_CACHE_TTL_MS) return cached.options;

  try {
    const options = buildBrandingOptions(await findServiceProducts(admin));
    brandingOptionsCache.set(shop, { options, at: Date.now() });
    return options;
  } catch (err) {
    console.warn("[Branding Service] Could not read the branding service products:", err);
    return [];
  }
}

export function buildBrandingMetafield(options: BrandingOption[]) {
  return {
    namespace: BRANDING_METAFIELD_NAMESPACE,
    key: BRANDING_METAFIELD_KEY,
    type: "json",
    value: JSON.stringify(options),
  };
}

type MetafieldsSetResult = {
  metafieldsSet: { userErrors: Array<{ field?: string[] | null; message: string }> };
};

async function setBrandingMetafields(
  admin: AdminGraphqlClient,
  entries: Array<{ ownerId: string; options: BrandingOption[] }>
): Promise<string[]> {
  const data = await brandingGraphql<MetafieldsSetResult>(
    admin,
    `#graphql
    mutation setBrandingOptions($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    { metafields: entries.map(({ ownerId, options }) => ({ ownerId, ...buildBrandingMetafield(options) })) }
  );
  return data.metafieldsSet.userErrors.map((e) => e.message);
}

/**
 * Each product's supplier decoration methods, read back from the
 * `trends.branding_options` metafield the product sync writes — so a bulk
 * run needs no Trends API calls. A product without that metafield (deleted,
 * or never fully synced) is absent from the result.
 */
async function readSupplierMethodNames(
  admin: AdminGraphqlClient,
  productIds: string[]
): Promise<Map<string, string[]>> {
  const data = await brandingGraphql<{
    nodes: Array<{ id?: string; supplierBranding?: { value: string } | null } | null>;
  }>(
    admin,
    `#graphql
    query brandingSupplierMethods($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          supplierBranding: metafield(namespace: "trends", key: "branding_options") {
            value
          }
        }
      }
    }`,
    { ids: productIds }
  );

  const byProduct = new Map<string, string[]>();
  for (const node of data.nodes) {
    if (!node?.id || !node.supplierBranding) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(node.supplierBranding.value);
    } catch {
      continue;
    }
    byProduct.set(
      node.id,
      extractSupportedMethodNames({
        branding_options: Array.isArray(parsed) ? (parsed as Array<{ print_type?: string }>) : [],
      })
    );
  }
  return byProduct;
}

export interface SyncBrandingMetafieldsResult {
  options: BrandingOption[];
  totalProducts: number;
  updatedCount: number;
  /** Written with at least one supported method. */
  withBrandingCount: number;
  /** No `trends.branding_options` on the product — written as [] until it's resynced. */
  missingSupplierDataCount: number;
  failures: Array<{ productId: string; error: string }>;
}

/**
 * Writes each synced Shopify product its OWN `branding.options`: only the
 * master methods its supplier data says it supports ([] if none), 25 per
 * metafieldsSet call (its per-request maximum). metafieldsSet is atomic per
 * call, so a failed batch is retried product-by-product to keep one stale
 * product (e.g. deleted in Shopify) from blocking the other 24.
 */
export async function syncBrandingMetafieldsToProducts({
  admin,
  shop,
}: {
  admin: AdminGraphqlClient;
  shop: string;
}): Promise<SyncBrandingMetafieldsResult> {
  const products = await findServiceProducts(admin);
  if (!products.run || !products.setup) {
    throw new BrandingServiceError("The branding service isn't initialized yet — connect it first.");
  }
  const options = buildBrandingOptions(products);
  if (options.length === 0) {
    throw new BrandingServiceError(
      "No branding method has a variant in both the Custom Branding and Setup Charge products, so there is nothing to sync."
    );
  }
  const serviceProductIds = [products.run.id, products.setup.id];
  brandingOptionsCache.set(shop, { options, at: Date.now() });

  await ensureBrandingMetafieldDefinition(admin);

  const rows = await prisma.trendProductSync.findMany({
    where: { shop },
    select: { shopifyProductId: true },
  });
  const productIds = rows
    .map((r) => r.shopifyProductId)
    .filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id) && !serviceProductIds.includes(id));

  let updatedCount = 0;
  let withBrandingCount = 0;
  let missingSupplierDataCount = 0;
  const failures: SyncBrandingMetafieldsResult["failures"] = [];

  for (let i = 0; i < productIds.length; i += METAFIELDS_SET_BATCH_SIZE) {
    const batch = productIds.slice(i, i + METAFIELDS_SET_BATCH_SIZE);
    let supplierMethods: Map<string, string[]>;
    try {
      supplierMethods = await readSupplierMethodNames(admin, batch);
    } catch (err) {
      // Never fall through to writing [] — that would wipe real branding.
      const error = `Could not read supplier branding data: ${err instanceof Error ? err.message : String(err)}`;
      for (const productId of batch) failures.push({ productId, error });
      continue;
    }
    const entries = batch.map((ownerId) => {
      const supported = supplierMethods.get(ownerId);
      if (!supported) missingSupplierDataCount += 1;
      return { ownerId, options: filterBrandingOptionsForProduct(options, supported ?? []) };
    });
    const countWritten = (written: typeof entries) => {
      updatedCount += written.length;
      withBrandingCount += written.filter((e) => e.options.length > 0).length;
    };

    try {
      const errors = await setBrandingMetafields(admin, entries);
      if (errors.length === 0) {
        countWritten(entries);
        continue;
      }
    } catch (err) {
      console.warn("[Branding Service] metafieldsSet batch failed, retrying per product:", err);
    }

    for (const entry of entries) {
      try {
        const errors = await setBrandingMetafields(admin, [entry]);
        if (errors.length === 0) countWritten([entry]);
        else failures.push({ productId: entry.ownerId, error: errors.join("; ") });
      } catch (err) {
        failures.push({ productId: entry.ownerId, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return {
    options,
    totalProducts: productIds.length,
    updatedCount,
    withBrandingCount,
    missingSupplierDataCount,
    failures,
  };
}
