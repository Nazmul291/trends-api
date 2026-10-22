/**
 * Shared pricing/margin calculation engine.
 *
 * This is the SINGLE source of truth for turning a raw Trends API cost tier
 * into a final selling price — imported by both the Product Details page's
 * live preview (app/) and the Shopify sync pipeline (server/), so the number
 * a merchant sees while typing a markup % is guaranteed to be the number
 * that eventually lands on the Shopify variant price / volume_pricing
 * metafield. Never duplicate this math elsewhere.
 */

/** A single additional_costs[] entry from the Trends API product payload. */
export interface AdditionalCostOption {
  id?: number | string;
  description?: string;
  branding_option?: string;
  unit_price?: number | string;
  setup_price?: number | string;
}

/**
 * Per-quantity-tier markup % overrides, e.g. { "100": 35, "5000": 25 } —
 * keyed by tier quantity as a string (this is what a JSON column round-trips
 * as). A tier missing from this map falls back to defaultMarkupPercent, not
 * to any other tier's value — each tier's markup is independent, mirroring
 * the Trends portal's own quote calculator.
 */
export type TierMarkupMap = Record<string, number>;

/** Resolved pricing configuration for one product — override-or-default already applied. */
export interface ResolvedPricingConfig {
  /** Shop-wide fallback used for any tier not present in tierMarkups. */
  defaultMarkupPercent: number;
  tierMarkups: TierMarkupMap | null;
  includeSetupInUnitCost: boolean;
  shippingBufferPerUnit: number;
  selectedAdditionalCostId: number | null;
  /** Merchant-defined tier quantities replacing the supplier's breaks, or null to use the supplier's. */
  customTierQuantities: number[] | null;
}

/** This tier's markup %: its own override if set, else the shop-wide default. */
export function resolveMarkupPercentForTier(config: ResolvedPricingConfig, quantity: number): number {
  const override = config.tierMarkups?.[String(quantity)];
  return typeof override === "number" && Number.isFinite(override) ? override : config.defaultMarkupPercent;
}

export interface PricingEngineInput {
  baseTierPrice: number;
  tierQuantity: number;
  printUnitCost: number;
  setupFee: number;
  includeSetupInUnitCost: boolean;
  shippingBufferPerUnit: number;
  markupPercent: number;
}

export interface PricingEngineResult {
  setupAllocationPerUnit: number;
  unitCost: number;
  finalSellingPrice: number;
}

/**
 * Strict two-step calculation, per the approved design — markup is applied
 * ONLY at the end, to the cumulative unit cost, never to the base tier price
 * alone:
 *
 *   Step 1: unitCost = baseTierPrice + printUnitCost
 *                       + (includeSetup ? setupFee / tierQuantity : 0)
 *                       + shippingBufferPerUnit
 *   Step 2: finalSellingPrice = unitCost * (1 + markupPercent / 100)
 */
export function computeTierPricing(input: PricingEngineInput): PricingEngineResult {
  const setupAllocationPerUnit =
    input.includeSetupInUnitCost && input.tierQuantity > 0 ? input.setupFee / input.tierQuantity : 0;

  const unitCost = input.baseTierPrice + input.printUnitCost + setupAllocationPerUnit + input.shippingBufferPerUnit;

  const finalSellingPrice = Math.round(unitCost * (1 + input.markupPercent / 100) * 100) / 100;

  return { setupAllocationPerUnit, unitCost, finalSellingPrice };
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Finds the additional_costs[] entry a product's pricing config points at
 * (by id), or null if none is selected / the id no longer matches anything
 * (e.g. the product's branding options changed on a later Trends sync).
 */
export function resolveSelectedAdditionalCost(
  additionalCosts: AdditionalCostOption[] | undefined,
  selectedAdditionalCostId: number | null
): AdditionalCostOption | null {
  // `0` is the deliberate "None / Unbranded" sentinel (see findDefaultAdditionalCost
  // callers) — no real Trends additional_costs[].id is ever 0, so `!selectedAdditionalCostId`
  // correctly treats both `0` and `null` as "no cost to apply" without conflating them
  // upstream: callers must still distinguish `null` ("never chosen, use the Screen Print
  // default") from `0` ("explicitly chose None") when resolving an override.
  if (!selectedAdditionalCostId || !Array.isArray(additionalCosts)) return null;
  // Trends' additional_costs[].id is typed number | string defensively — compare
  // numerically so a stored numeric id still matches a stringified one.
  return additionalCosts.find((c) => Number(c.id) === selectedAdditionalCostId) || null;
}

/**
 * Convenience wrapper: resolves the selected additional cost option AND this
 * specific tier's markup %, and runs the {quantity, price} tier through
 * computeTierPricing in one call.
 */
export function computeTierPricingFromTier(
  tier: { quantity: number; price: number | string },
  additionalCosts: AdditionalCostOption[] | undefined,
  config: ResolvedPricingConfig
): PricingEngineResult {
  const selected = resolveSelectedAdditionalCost(additionalCosts, config.selectedAdditionalCostId);
  return computeTierPricing({
    baseTierPrice: toNumber(tier.price),
    tierQuantity: tier.quantity,
    printUnitCost: toNumber(selected?.unit_price),
    setupFee: toNumber(selected?.setup_price),
    includeSetupInUnitCost: config.includeSetupInUnitCost,
    shippingBufferPerUnit: config.shippingBufferPerUnit,
    markupPercent: resolveMarkupPercentForTier(config, tier.quantity),
  });
}

export interface SupplierTier {
  quantity: number;
  price: number;
}

/** Valid supplier quantity breaks, parsed to numbers and sorted ascending. */
export function normalizeSupplierTiers(
  prices: Array<{ quantity: number | string; price: number | string }> | undefined
): SupplierTier[] {
  if (!Array.isArray(prices)) return [];
  return prices
    .map((p) => ({ quantity: toNumber(p.quantity), price: toNumber(p.price) }))
    .filter((p) => p.quantity > 0 && p.price > 0)
    .sort((a, b) => a.quantity - b.quantity);
}

/**
 * Supplier base cost for an arbitrary quantity: the highest supplier break at
 * or below it. A quantity under the supplier's smallest break (below MOQ)
 * uses that smallest break's price — the most expensive per-unit cost on offer.
 */
export function resolveSupplierCostForQuantity(supplierTiers: SupplierTier[], quantity: number): number {
  if (supplierTiers.length === 0) return 0;
  let cost = supplierTiers[0].price;
  for (const tier of supplierTiers) {
    if (tier.quantity <= quantity) cost = tier.price;
    else break;
  }
  return cost;
}

/**
 * The tier list actually priced and pushed to Shopify: the supplier's own
 * breaks, or the merchant's custom quantities with each base cost resolved
 * live from the supplier's applicable break (so supplier price changes still
 * flow through custom tiers on resync).
 */
export function buildEffectiveTiers(
  supplierTiers: SupplierTier[],
  customTierQuantities: number[] | null
): SupplierTier[] {
  if (!customTierQuantities || customTierQuantities.length === 0 || supplierTiers.length === 0) {
    return supplierTiers;
  }
  return [...customTierQuantities]
    .sort((a, b) => a - b)
    .map((quantity) => ({ quantity, price: resolveSupplierCostForQuantity(supplierTiers, quantity) }));
}

/** Positive whole numbers in strictly ascending order (which also guarantees uniqueness). */
export function isValidTierQuantityList(quantities: number[]): boolean {
  return (
    quantities.length > 0 &&
    quantities.every((q, i) => Number.isInteger(q) && q > 0 && (i === 0 || q > quantities[i - 1]))
  );
}

/**
 * Strips out any tier entry whose markup % is identical to the shop-wide
 * default — such an entry carries no real override information, so keeping
 * it out of storage/comparison means "every tier matches the global default"
 * reduces to an empty map, which is what the Automatic Override Detection UI
 * (app/routes/app.products.$id.tsx) and the savePricingOverride action both
 * use to decide "use global defaults" vs. "custom override active."
 */
export function filterOverriddenTierMarkups(
  tierMarkups: TierMarkupMap | null | undefined,
  defaultMarkupPercent: number
): TierMarkupMap {
  if (!tierMarkups) return {};
  const filtered: TierMarkupMap = {};
  for (const [quantity, percent] of Object.entries(tierMarkups)) {
    if (typeof percent === "number" && Number.isFinite(percent) && percent !== defaultMarkupPercent) {
      filtered[quantity] = percent;
    }
  }
  return filtered;
}

/**
 * Picks the default branding option when a product has no selection yet:
 * prefers an exact "Rotary Screen Print" match, then any "Screen Print"
 * match, else null (falls through to "None" / unbranded — printUnitCost and
 * setupFee both 0).
 */
export function findDefaultAdditionalCost(
  additionalCosts: AdditionalCostOption[] | undefined
): AdditionalCostOption | null {
  if (!Array.isArray(additionalCosts) || additionalCosts.length === 0) return null;

  const matches = (pattern: RegExp, c: AdditionalCostOption) =>
    pattern.test(c.description || "") || pattern.test(c.branding_option || "");

  const rotaryMatch = additionalCosts.find((c) => matches(/rotary\s*screen\s*print/i, c));
  if (rotaryMatch) return rotaryMatch;

  const screenPrintMatch = additionalCosts.find((c) => matches(/screen\s*print/i, c));
  return screenPrintMatch || null;
}
