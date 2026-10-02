import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`[Webhook] Received ${topic} webhook for ${shop}`);

    const currentScopes = (payload?.current || []) as string[];
    const previousScopes = (payload?.previous || []) as string[];

    console.info(`[Webhook:scopes_update] Shop: ${shop}`);
    console.info(`[Webhook:scopes_update] Previous scopes: ${previousScopes.join(", ") || "none"}`);
    console.info(`[Webhook:scopes_update] Current scopes: ${currentScopes.join(", ") || "none"}`);

    if (currentScopes.length > 0) {
      const scopeString = currentScopes.join(",");
      if (session) {
        await db.session.update({
          where: { id: session.id },
          data: { scope: scopeString },
        });
      } else {
        await db.session.updateMany({
          where: { shop },
          data: { scope: scopeString },
        });
      }
      console.info(`[Webhook:scopes_update] Updated stored session scopes for shop: ${shop}`);
    }

    return new Response(null, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Webhook:scopes_update] Webhook processing exception:", message);
    return new Response(null, { status: 200 });
  }
};
