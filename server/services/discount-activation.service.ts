import { executeShopifyGraphql } from "./shopify-sync.service";

export interface ActivateVolumeDiscountResult {
  success: boolean;
  status: "already_active" | "created" | "function_not_found" | "error";
  discountId?: string;
  functionId?: string;
  message: string;
}

/**
 * Finds the deployed `tiered-discount-function` Shopify Function's id for this app.
 * Deploying a Function only uploads its Wasm binary — it isn't a live discount until
 * an automatic/code discount record is created that references this id.
 */
async function findVolumePricingFunctionId(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> }
): Promise<string | null> {
  const res = await executeShopifyGraphql(
    admin,
    `#graphql
    query ListShopifyFunctions {
      shopifyFunctions(first: 50) {
        nodes {
          id
          title
          apiType
        }
      }
    }`
  );

  const nodes: Array<{ id: string; title: string; apiType: string }> =
    res.data?.shopifyFunctions?.nodes || [];

  // Match by title set in extensions/tiered-discount-function/locales/en.default.json,
  // scoped to the product-discount API type so we never pick up an unrelated function.
  const match =
    nodes.find(
      (n) => n.apiType === "product_discounts" && n.title === "Trends Volume Pricing"
    ) || nodes.find((n) => n.apiType === "product_discounts");

  return match?.id || null;
}

/**
 * Checks whether an automatic app discount already references the given functionId,
 * so re-running activation is idempotent instead of creating duplicate discounts.
 */
async function findExistingAutomaticDiscount(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  functionId: string
): Promise<{ id: string; status: string } | null> {
  const res = await executeShopifyGraphql(
    admin,
    `#graphql
    query ExistingAutomaticAppDiscounts {
      discountNodes(first: 50) {
        nodes {
          id
          discount {
            __typename
            ... on DiscountAutomaticApp {
              status
              appDiscountType {
                functionId
              }
            }
          }
        }
      }
    }`
  );

  const nodes: Array<{
    id: string;
    discount: { __typename: string; status?: string; appDiscountType?: { functionId?: string } };
  }> = res.data?.discountNodes?.nodes || [];

  const match = nodes.find(
    (n) => n.discount?.__typename === "DiscountAutomaticApp" && n.discount.appDiscountType?.functionId === functionId
  );

  return match ? { id: match.id, status: match.discount.status || "UNKNOWN" } : null;
}

/**
 * Ensures the volume-pricing Shopify Function is live as an automatic discount.
 * Safe to call repeatedly — does nothing if one already exists for this function.
 */
export async function activateVolumePricingDiscount(admin: {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}): Promise<ActivateVolumeDiscountResult> {
  try {
    const functionId = await findVolumePricingFunctionId(admin);
    if (!functionId) {
      return {
        success: false,
        status: "function_not_found",
        message:
          "No deployed 'product_discounts' Shopify Function found for this app. Run `npm run deploy` first " +
          "(the discount can only be activated after the Function itself has been deployed).",
      };
    }

    const existing = await findExistingAutomaticDiscount(admin, functionId);
    if (existing) {
      return {
        success: true,
        status: "already_active",
        discountId: existing.id,
        functionId,
        message: `Volume pricing discount is already registered (status: ${existing.status}).`,
      };
    }

    const createRes = await executeShopifyGraphql(
      admin,
      `#graphql
      mutation CreateAutomaticDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            discountId
            title
            status
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          automaticAppDiscount: {
            title: "Volume Tiered Discount",
            functionId,
            startsAt: new Date().toISOString(),
            combinesWith: {
              orderDiscounts: true,
              productDiscounts: true,
              shippingDiscounts: true,
            },
          },
        },
      }
    );

    const userErrors = createRes.data?.discountAutomaticAppCreate?.userErrors || [];
    if (userErrors.length > 0) {
      return {
        success: false,
        status: "error",
        functionId,
        message: `Shopify rejected the discount: ${userErrors.map((e: { message: string }) => e.message).join(", ")}`,
      };
    }

    const created = createRes.data?.discountAutomaticAppCreate?.automaticAppDiscount;
    if (!created?.discountId) {
      return {
        success: false,
        status: "error",
        functionId,
        message: "discountAutomaticAppCreate returned no discount and no userErrors — unexpected response shape.",
      };
    }

    return {
      success: true,
      status: "created",
      discountId: created.discountId,
      functionId,
      message: `Volume pricing discount activated (status: ${created.status}).`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error activating volume pricing discount";
    return { success: false, status: "error", message };
  }
}
