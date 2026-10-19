import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncCartDiscount, type CartDiscountLineInput } from "../../server/services/dynamic-discount.service";

/**
 * Storefront-facing endpoint behind Shopify's app proxy (see [app_proxy] in
 * shopify.app.toml — proxied from https://{shop}/apps/volume-discount/sync).
 * authenticate.public.appProxy verifies Shopify's own HMAC signature on the
 * request, so this never trusts a client-supplied shop or admin session —
 * unlike api/proxy/$.ts (used only from inside the authenticated embedded
 * app), this route is reachable by anyone, so that verification is load-bearing.
 *
 * No CORS/OPTIONS handling here deliberately: an app-proxy request is
 * Shopify's edge calling this URL server-to-server, after the browser's
 * fetch to https://{shop}/apps/volume-discount/sync (same-origin as the
 * storefront) — the browser never talks to this URL directly, so there is
 * no cross-origin request and no preflight to answer. A direct fetch from
 * this URL's own origin (e.g. testing with curl) is expected to come back
 * with a 400 from authenticate.public.appProxy, since it won't carry
 * Shopify's signature — that 400 is itself proof the route is reachable.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Wraps the WHOLE handler, not just the syncCartDiscount call — a prior
  // version only caught errors from that one call, leaving
  // authenticate.public.appProxy() and request.json() able to throw an
  // unhandled exception that React Router turns into a bare 500 with no
  // JSON body at all (the frontend's res.json() then throws its own
  // SyntaxError trying to parse that, masking the real failure). With
  // expiringOfflineAccessTokens enabled (shopify.server.ts), appProxy() can
  // attempt to refresh a near-expiry offline token as part of resolving the
  // session — that refresh call is exactly the kind of thing that can throw
  // for reasons having nothing to do with this route's own logic.
  try {
    if (request.method !== "POST") {
      return Response.json({ success: false, message: "Method not allowed" }, { status: 405 });
    }

    // authenticate.public.appProxy throws a plain Response(400) itself if
    // Shopify's HMAC signature on the request doesn't validate (e.g. the URL
    // was hit directly instead of proxied through
    // https://{shop}/apps/volume-discount/sync) — that's intentional
    // framework control flow, not a crash, so it's re-thrown as-is below
    // rather than being caught and turned into a 500.
    const { session, admin } = await authenticate.public.appProxy(request);
    if (!session || !admin) {
      console.warn("[AppProxy] /apps/proxy/sync: signature valid but no offline session for this shop.");
      return Response.json({ success: false, message: "No active session for this shop." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      cartToken?: string;
      lines?: Array<Record<string, unknown>>;
    } | null;

    const cartToken = body?.cartToken?.trim();
    if (!cartToken) {
      return Response.json({ success: false, message: "Missing cartToken" }, { status: 400 });
    }

    const lines = Array.isArray(body?.lines) ? body.lines : [];
    // `item.product.id` in Liquid (where the client reads productId from) is
    // emitted as a raw JSON integer, not a string — `{{ item.product.id | json }}`
    // outputs e.g. `15452592079002`, never `"15452592079002"`. The filter
    // previously required typeof === "string" and silently dropped every
    // real line as a result. Accept either and normalize to string here, at
    // the boundary, so everything downstream (Map keys in
    // computeTotalSavings, Prisma storage) only ever deals with one type.
    const validLines: CartDiscountLineInput[] = lines
      .filter(
        (l) =>
          Boolean(l) &&
          (typeof l.productId === "string" || typeof l.productId === "number") &&
          Number.isFinite(l.quantity) &&
          Number.isFinite(l.basePrice) &&
          Array.isArray(l.tiers)
      )
      .map((l) => ({
        productId: String(l.productId),
        quantity: l.quantity as number,
        basePrice: l.basePrice as number,
        tiers: l.tiers as CartDiscountLineInput["tiers"],
      }));

    // If the client sent lines but every single one failed the shape check
    // above, that's a different failure than "cart genuinely doesn't
    // qualify yet" — both would otherwise produce the identical
    // "doesn't qualify" message from syncCartDiscount, making them
    // indistinguishable from the response alone.
    if (lines.length > 0 && validLines.length === 0) {
      console.warn("[AppProxy] all submitted lines were dropped by the shape filter:", lines);
      return Response.json({
        success: true,
        qualifies: false,
        message:
          `All ${lines.length} submitted line(s) failed validation (productId must be a string or number, ` +
          "quantity/basePrice must be finite numbers, tiers must be an array) and were dropped before tier " +
          "matching ever ran.",
      });
    }

    const result = await syncCartDiscount(admin, session.shop, cartToken, validLines);
    return Response.json({ success: true, ...result });
  } catch (err) {
    // Only appProxy's own 400 (invalid HMAC signature) is intentional
    // control flow to let propagate untouched. Any OTHER thrown Response is
    // NOT intentional — e.g. the SDK's own ensureOfflineTokenIsNotExpired ->
    // refreshToken helper throws a bare `Response(undefined, {status: 500})`
    // when a token-refresh attempt fails (expiringOfflineAccessTokens is on
    // in shopify.server.ts, so a near-expiry offline session triggers this).
    // Re-throwing THAT uncaught, with no matching ErrorBoundary, is exactly
    // what produced the raw "<!doctype html>" 500 body seen in testing —
    // React Router falls back to its default HTML error document. Treating
    // it like any other error here instead converts it into readable JSON.
    if (err instanceof Response && err.status === 400) {
      throw err;
    }

    const message =
      err instanceof Response
        ? `Shopify SDK rejected the request with a bare Response (status ${err.status}) — most likely a failed ` +
          "offline-token refresh. This shop's session likely needs re-authentication: reload the embedded app " +
          "in Shopify Admin while the dev server is running."
        : err instanceof Error
        ? err.message
        : "Failed to sync volume pricing discount.";
    console.error("[AppProxy Error]:", err);
    // The error message (not the raw stack) goes in the response: this
    // endpoint is reachable from the live storefront via Shopify's proxy,
    // so shipping a full stack trace (file paths, internals) to that
    // response body is an information-disclosure risk. The full
    // console.error above already has the complete stack for debugging.
    return Response.json({ success: false, qualifies: false, message }, { status: 500 });
  }
};
