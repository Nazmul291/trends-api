import crypto from "node:crypto";
import { executeShopifyGraphql } from "./shopify-sync.service";
import prisma from "../../app/db.server";

type AdminLike = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

/** Shape the storefront script posts per cart line it can see tier data for. */
export interface CartDiscountLineInput {
  productId: string;
  quantity: number;
  basePrice: number;
  tiers: Array<{ minQuantity: number; price: number }>;
}

export interface SyncCartDiscountResult {
  qualifies: boolean;
  code?: string;
  amount?: string;
  expiresAt?: string;
  message: string;
  /** True when this call tore down a previously-active code for this cart (whether or not a new one replaced it). */
  cleared?: boolean;
  /** True when the existing code already matched the freshly computed savings/quantity — no Shopify mutation ran. */
  reused?: boolean;
}

const CODE_LIFETIME_MS = 36 * 60 * 60 * 1000; // 36h: inside the 24-48h operational fail-safe window

function sortTiersDescending(
  tiers: Array<{ minQuantity: number; price: number }>
): Array<{ minQuantity: number; price: number }> {
  return [...tiers].sort((a, b) => b.minQuantity - a.minQuantity);
}

function bestQualifyingTier(
  tiers: Array<{ minQuantity: number; price: number }>,
  quantity: number
): { minQuantity: number; price: number } | null {
  for (const tier of sortTiersDescending(tiers)) {
    if (quantity >= tier.minQuantity) return tier;
  }
  return null;
}

interface CartSavingsComputation {
  totalSavings: number;
  /** Sum of every line's quantity, regardless of product — the "mix & match" total. */
  totalCartQuantity: number;
  /** True when totalCartQuantity doesn't clear even the lowest tier threshold present anywhere in the cart. */
  belowGlobalMinimum: boolean;
}

/**
 * Cart-wide "mix & match" aggregation: unlike the Shopify Function in
 * extensions/tiered-discount-function (which only aggregates quantity
 * within a single product's own variants, per run.ts), this engine treats
 * the WHOLE cart's unit count as one pool — a customer buying 150 of
 * product A and 150 of product B qualifies every tiered line for the
 * 300-unit tier, not just whichever single product happens to hit it alone.
 * This is a deliberate product decision for the dynamic discount-code path
 * specifically, not a bug — the Function's own per-product behavior is
 * unchanged (and is currently unused anyway; see SHOW_PLUS_DISCOUNT_ACTIVATION_CARD
 * in app.settings.tsx). It does mean the storefront's own per-product price
 * display (volume-pricing-global.js, which still mirrors the Function's
 * per-product model) can show a different qualifying tier than what the
 * issued discount code actually reflects for a genuinely mixed cart.
 */
function computeCartSavings(lines: CartDiscountLineInput[]): CartSavingsComputation {
  const totalCartQuantity = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  let globalMinThreshold: number | null = null;
  for (const line of lines) {
    if (!Array.isArray(line.tiers)) continue;
    for (const tier of line.tiers) {
      if (globalMinThreshold === null || tier.minQuantity < globalMinThreshold) {
        globalMinThreshold = tier.minQuantity;
      }
    }
  }

  const belowGlobalMinimum = globalMinThreshold !== null && totalCartQuantity < globalMinThreshold;

  let total = 0;
  if (!belowGlobalMinimum) {
    for (const line of lines) {
      if (!Array.isArray(line.tiers) || line.tiers.length === 0) continue;

      // Qualification uses the CART-WIDE total, not this line's own
      // quantity — that's the "mix & match" behavior requested. Savings are
      // still scaled by this line's own quantity, since that's how many
      // units of it were actually bought.
      const tier = bestQualifyingTier(line.tiers, totalCartQuantity);
      const lineSavings =
        tier && tier.price < line.basePrice ? (line.basePrice - tier.price) * line.quantity : 0;

      total += lineSavings;
    }
  }

  return {
    totalSavings: Math.round(total * 100) / 100,
    totalCartQuantity,
    belowGlobalMinimum,
  };
}

function generateCode(): string {
  return "VOL-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

/** Returns whether the Shopify-side discount is confirmed gone (deleted now, or already gone). */
async function deleteShopifyDiscountCode(admin: AdminLike, discountNodeId: string): Promise<boolean> {
  try {
    const res = await executeShopifyGraphql(
      admin,
      `#graphql
      mutation DeleteVolumeDiscountCode($id: ID!) {
        discountCodeDelete(id: $id) {
          deletedCodeDiscountId
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: discountNodeId } }
    );

    const userErrors = res.data?.discountCodeDelete?.userErrors || [];
    if (userErrors.length > 0) {
      console.warn(`[DynamicDiscount] discountCodeDelete rejected for ${discountNodeId}:`, userErrors);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[DynamicDiscount] Failed to delete Shopify discount ${discountNodeId}:`, err);
    return false;
  }
}

/**
 * Deletes any discount code previously issued for this cart (both the
 * Shopify-side record and our tracking row), so a stale single-use code
 * never lingers after the cart that earned it has changed.
 *
 * If the Shopify-side delete fails, the tracking row is deliberately left
 * in place instead of being removed anyway — forgetting about a discount
 * we failed to delete, and then going on to create a brand-new one, is
 * exactly how two active codes for the same cart pile up in Shopify Admin.
 * Keeping the row means the next sync retries deleting this SAME discount.
 */
export async function invalidateCartDiscount(
  admin: AdminLike,
  shop: string,
  cartToken: string
): Promise<{ hadActiveCode: boolean; cleared: boolean }> {
  const existing = await prisma.volumeDiscountCode.findUnique({
    where: { shop_cartToken: { shop, cartToken } },
  });
  if (!existing) return { hadActiveCode: false, cleared: true };

  const deleted = await deleteShopifyDiscountCode(admin, existing.discountNodeId);
  if (!deleted) {
    return { hadActiveCode: true, cleared: false };
  }

  await prisma.volumeDiscountCode.delete({ where: { id: existing.id } }).catch(() => {
    // Row already gone (e.g. a concurrent sync won the race) — fine.
  });
  return { hadActiveCode: true, cleared: true };
}

/**
 * The single entry point the storefront's app-proxy endpoint calls on every
 * cart mutation: always invalidates whatever code was active for this cart
 * first, then issues a brand-new single-use code for the freshly computed
 * savings if the cart still qualifies. Doing both steps in one call (instead
 * of separate "clear" and "apply" round trips) avoids a race window where a
 * second rapid mutation could overlap an in-flight delete/create pair.
 */
export async function syncCartDiscount(
  admin: AdminLike,
  shop: string,
  cartToken: string,
  lines: CartDiscountLineInput[]
): Promise<SyncCartDiscountResult> {
  const { totalSavings, totalCartQuantity, belowGlobalMinimum } = computeCartSavings(lines);
  const qualifiesNow = !belowGlobalMinimum && totalSavings > 0;

  // Reuse check, BEFORE touching Shopify at all: if what's already live for
  // this cart exactly matches what was just computed, every mutation below
  // would be pure churn — deleting and re-creating a discount with the
  // identical amount and quantity it already has. This is what actually
  // stops duplicates from piling up on a busy page where unrelated DOM
  // churn (a chat widget, a countdown timer) keeps re-triggering a sync
  // with no real change to the cart.
  if (qualifiesNow) {
    const existing = await prisma.volumeDiscountCode.findUnique({
      where: { shop_cartToken: { shop, cartToken } },
    });
    if (
      existing &&
      existing.amount === totalSavings.toFixed(2) &&
      existing.totalCartQuantity === totalCartQuantity &&
      existing.expiresAt.getTime() > Date.now()
    ) {
      return {
        qualifies: true,
        reused: true,
        cleared: false,
        code: existing.code,
        amount: existing.amount,
        expiresAt: existing.expiresAt.toISOString(),
        message: "Existing code is already optimal for this cart.",
      };
    }
  }

  // Always invalidate before issuing anything new — covers both "still
  // qualifies but for a different amount" and "no longer qualifies at all"
  // in one place. If the Shopify-side delete fails, stop here rather than
  // create a second code while the old one might still be live — that's
  // exactly how duplicates accumulate in Shopify Admin.
  const { hadActiveCode, cleared } = await invalidateCartDiscount(admin, shop, cartToken);
  if (hadActiveCode && !cleared) {
    return {
      qualifies: false,
      cleared: false,
      message: "Could not clear the previous discount code yet — will retry on the next cart update.",
    };
  }

  if (belowGlobalMinimum) {
    return {
      qualifies: false,
      cleared: hadActiveCode,
      message: "Cart does not meet the minimum aggregate quantity requirement.",
    };
  }
  if (totalSavings <= 0) {
    return { qualifies: false, cleared: hadActiveCode, message: "Cart does not currently qualify for any volume tier." };
  }

  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_LIFETIME_MS);
  const amount = totalSavings.toFixed(2);

  const res = await executeShopifyGraphql(
    admin,
    `#graphql
    mutation CreateVolumeDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
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
        basicCodeDiscount: {
          title: `Volume pricing (auto) — ${cartToken.slice(0, 12)}`,
          code,
          startsAt: now.toISOString(),
          endsAt: expiresAt.toISOString(),
          usageLimit: 1,
          appliesOncePerCustomer: true,
          // Required on create (the error this fixes: "Context can't be
          // blank") — DiscountCodeBasicInput needs either `context` or the
          // deprecated `customerSelection`; `context: { all: ALL }` makes
          // the code usable by any buyer who has it, matching usageLimit: 1
          // + appliesOncePerCustomer for the single-use-per-cart behavior.
          context: { all: "ALL" },
          // Pins the code to the EXACT cart-wide quantity that earned this
          // savings amount, not just the qualifying tier's own threshold —
          // if the customer drops quantity by even one unit after the code
          // is issued but before using it, Shopify's own checkout
          // validation rejects the code natively, without relying on our
          // debounced re-sync to catch it first. UnsignedInt64 is
          // represented as a string in GraphQL variables.
          minimumRequirement: {
            quantity: { greaterThanOrEqualToQuantity: String(totalCartQuantity) },
          },
          customerGets: {
            value: { discountAmount: { amount, appliesOnEachItem: false } },
            items: { all: true },
          },
          combinesWith: {
            orderDiscounts: false,
            productDiscounts: true,
            shippingDiscounts: true,
          },
        },
      },
    }
  );

  const userErrors = res.data?.discountCodeBasicCreate?.userErrors || [];
  if (userErrors.length > 0) {
    const msg = userErrors.map((e: { message: string }) => e.message).join(", ");
    console.warn(`[DynamicDiscount] discountCodeBasicCreate rejected for shop ${shop}:`, msg);
    return { qualifies: false, message: `Shopify rejected the discount code: ${msg}` };
  }

  const discountNodeId = res.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
  if (!discountNodeId) {
    return { qualifies: false, message: "discountCodeBasicCreate returned no discount node — unexpected response." };
  }

  // upsert, not create: invalidateCartDiscount() above already removes any
  // existing (shop, cartToken) row sequentially within this call, but if a
  // second request for the same cart overlaps this one in flight (a
  // debounce burst, or two rapid mutations), that other call's own
  // invalidate+create can land between this call's invalidate and this
  // create, leaving a row here that a plain create() would collide with on
  // the unique (shop, cartToken) index. upsert makes the final write
  // idempotent regardless of that ordering.
  await prisma.volumeDiscountCode.upsert({
    where: { shop_cartToken: { shop, cartToken } },
    update: { discountNodeId, code, amount, totalCartQuantity, expiresAt },
    create: { shop, cartToken, discountNodeId, code, amount, totalCartQuantity, expiresAt },
  });

  return {
    qualifies: true,
    cleared: hadActiveCode,
    code,
    amount,
    expiresAt: expiresAt.toISOString(),
    message: "Discount code issued.",
  };
}
