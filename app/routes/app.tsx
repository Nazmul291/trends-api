import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { RegionSelector } from "../components/molecules/RegionSelector";
import { getAppSettings } from "../../server/settings/app-settings.service";
import type { Region } from "../../shared/types/trends.types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getAppSettings(session.shop);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    enabledRegions: settings.enabledRegions as Region[],
  };
};

export default function App() {
  const { apiKey, enabledRegions } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Product Catalog</s-link>
        <s-link href="/app/orders">Orders &amp; Tracking</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          backgroundColor: "#ffffff",
          borderBottom: "1px solid #e1e3e5",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px" }}>⚡</span>
          <span style={{ fontSize: "16px", fontWeight: 700, color: "#202223" }}>
            TRENDS Promotional Gateway
          </span>
        </div>
        {/* Only render the selector if there is more than one enabled region */}
        {enabledRegions.length > 1 && <RegionSelector enabledRegions={enabledRegions} />}
      </div>

      <div style={{ padding: "0 24px 32px 24px" }}>
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
