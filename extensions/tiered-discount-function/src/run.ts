import type { RunInput, FunctionRunResult, Discount } from "../generated/api";
import { DiscountApplicationStrategy } from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

/** Normalized shape stored in the product metafield custom.volume_pricing. */
interface VolumeTier {
  minQuantity: number;
  price: number;
}

/**
 * Parses and validates the `custom.volume_pricing` metafield JSON.
 * Returns tiers sorted by `minQuantity` descending, so the first tier a
 * quantity satisfies is always the best (highest-threshold) one. Any
 * malformed/missing metafield or malformed entry results in an empty list
 * rather than throwing — a Function that throws fails the whole discount
 * evaluation for the cart, which we never want for one bad product record.
 */
function parseVolumeTiers(rawValue: string | null | undefined): VolumeTier[] {
  if (!rawValue) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const tiers: VolumeTier[] = [];
  for (const entry of parsed) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).minQuantity === "number" &&
      typeof (entry as Record<string, unknown>).price === "number"
    ) {
      const minQuantity = (entry as Record<string, number>).minQuantity;
      const price = (entry as Record<string, number>).price;
      if (Number.isFinite(minQuantity) && minQuantity > 0 && Number.isFinite(price) && price >= 0) {
        tiers.push({ minQuantity, price });
      }
    }
  }

  return tiers.sort((a, b) => b.minQuantity - a.minQuantity);
}

/** Highest-threshold tier that `quantity` qualifies for, or null if none match. */
function bestQualifyingTier(tiers: VolumeTier[], quantity: number): VolumeTier | null {
  for (const tier of tiers) {
    if (quantity >= tier.minQuantity) {
      return tier;
    }
  }
  return null;
}

export function run(input: RunInput): FunctionRunResult {
  const lines = input.cart.lines;

  // Aggregate quantity per product (not per variant) so that, for example,
  // 60 units of one colorway plus 40 of another colorway of the same product
  // together qualify for a 100+ tier, matching how volume pricing is sold.
  const quantityByProductId = new Map<string, number>();
  for (const line of lines) {
    if (line.merchandise.__typename !== "ProductVariant") {
      continue;
    }
    const productId = line.merchandise.product.id;
    quantityByProductId.set(productId, (quantityByProductId.get(productId) ?? 0) + line.quantity);
  }

  const discounts: Discount[] = [];

  for (const line of lines) {
    if (line.merchandise.__typename !== "ProductVariant") {
      continue;
    }

    const variant = line.merchandise;
    const tiers = parseVolumeTiers(variant.product.metafield?.value);
    if (tiers.length === 0) {
      continue;
    }

    const aggregatedQuantity = quantityByProductId.get(variant.product.id) ?? line.quantity;
    const tier = bestQualifyingTier(tiers, aggregatedQuantity);
    if (!tier) {
      continue;
    }

    const currentPrice = Number.parseFloat(line.cost.amountPerQuantity.amount);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      continue;
    }

    // Only ever discount — never increase the price if the "tier" price is
    // higher than what the line is already selling for.
    if (tier.price >= currentPrice) {
      continue;
    }

    const discountPerUnit = currentPrice - tier.price;

    discounts.push({
      message: `Volume pricing: ${aggregatedQuantity}+ units at $${tier.price.toFixed(2)}/unit`,
      targets: [
        {
          cartLine: {
            id: line.id,
          },
        },
      ],
      value: {
        fixedAmount: {
          // appliesToEachItem: true means Shopify multiplies this per-unit
          // amount by the line's quantity, bringing the line's effective
          // unit price down to exactly tier.price.
          amount: discountPerUnit.toFixed(2),
          appliesToEachItem: true,
        },
      },
    });
  }

  if (discounts.length === 0) {
    return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All,
    discounts,
  };
}
