/**
 * Shared pricing/margin calculation engine.
 *
 * This is the SINGLE source of truth for turning a raw Trends API cost tier
 * into a final selling price — imported by both the Product Details page's
 * live preview (app/) and the Shopify sync pipeline (server/), so the number
 * a merchant sees while typing a markup % is guaranteed to be the number
 * that eventually lands on the Shopify variant price / volume_pricing
 * metafield. Never duplicate this math elsewhere.
 *
 * Branding (print/setup) is deliberately NOT part of this price: it's sold as
 * separate cart lines on the storefront, so baking it in would charge twice.
 */

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
  /** Merchant-defined tier quantities replacing the supplier's breaks, or null to use the supplier's. */
  customTierQuantities: number[] | null;
}

/** This tier's markup %: its own override if set, else the shop-wide default. */
export function resolveMarkupPercentForTier(config: ResolvedPricingConfig, quantity: number): number {
  const override = config.tierMarkups?.[String(quantity)];
  return typeof override === "number" && Number.isFinite(override) ? override : config.defaultMarkupPercent;
}

/** Sell Price = Base Cost × (1 + Markup %), rounded to cents. */
export function computeSellPrice(baseCost: number, markupPercent: number): number {
  return Math.round(baseCost * (1 + markupPercent / 100) * 100) / 100;
}

/** A {quantity, price} cost tier's sell price, using that tier's own markup %. */
export function computeTierSellPrice(
  tier: { quantity: number; price: number | string },
  config: ResolvedPricingConfig
): number {
  return computeSellPrice(toNumber(tier.price), resolveMarkupPercentForTier(config, tier.quantity));
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
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
