import React, { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAppSettings,
  saveAppSettings,
  ALL_REGIONS,
} from "../../server/settings/app-settings.service";
import type { Region } from "../../shared/types/trends.types";

// ---------------------------------------------------------------------------
// Region display metadata
// ---------------------------------------------------------------------------

const REGION_META: Record<Region, { flag: string; label: string; currency: string }> = {
  nz: { flag: "🇳🇿", label: "New Zealand", currency: "NZD" },
  au: { flag: "🇦🇺", label: "Australia", currency: "AUD" },
  sg: { flag: "🇸🇬", label: "Singapore", currency: "SGD" },
};

// ---------------------------------------------------------------------------
// Server-side: Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getAppSettings(shop);
  return {
    shop,
    trendsApiKey: settings.trendsApiKey ?? "",
    enableTrendsMockFallback: settings.enableTrendsMockFallback,
    enabledRegions: settings.enabledRegions,
  };
};

// ---------------------------------------------------------------------------
// Server-side: Action (form submission)
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const rawKey = formData.get("trendsApiKey");
  const mockFallbackVal = formData.get("enableTrendsMockFallback");

  // Collect enabled regions from form checkboxes
  const enabledRegions = ALL_REGIONS.filter((r) => formData.get(`region_${r}`) === "on");

  const trendsApiKey = typeof rawKey === "string" ? rawKey.trim() || null : null;
  const enableTrendsMockFallback = mockFallbackVal === "true";

  // Validate at least one region
  if (enabledRegions.length === 0) {
    return {
      success: false,
      error: "At least one region must remain enabled.",
    };
  }

  try {
    await saveAppSettings(shop, { trendsApiKey, enableTrendsMockFallback, enabledRegions });
    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save settings.",
    };
  }
};

// ---------------------------------------------------------------------------
// UI Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { trendsApiKey, enableTrendsMockFallback, enabledRegions } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [showKey, setShowKey] = useState(false);
  const [mockFallback, setMockFallback] = useState(enableTrendsMockFallback);
  const [activeRegions, setActiveRegions] = useState<Region[]>(enabledRegions as Region[]);

  const hasSaved = actionData?.success === true;
  const hasError = actionData?.success === false;

  const toggleRegion = (region: Region) => {
    setActiveRegions((prev) => {
      const isActive = prev.includes(region);
      // Block toggling off the last active region
      if (isActive && prev.length === 1) return prev;
      return isActive ? prev.filter((r) => r !== region) : [...prev, region];
    });
  };

  return (
    <div
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      {/* Page Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          backgroundColor: "#ffffff",
          padding: "20px 24px",
          borderRadius: "12px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <span style={{ fontSize: "24px" }}>⚙️</span>
        <div>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#202223" }}>
            Trends API Settings
          </h1>
          <p style={{ margin: 0, fontSize: "13px", color: "#6d7175" }}>
            Configure your Trends API credentials, fallback behaviour, and active regions. Changes
            take effect immediately without redeployment.
          </p>
        </div>
      </div>

      {/* Toast / Status Banner */}
      {hasSaved && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#f3fdf7",
            border: "1px solid #1a9e6c",
            borderRadius: "10px",
            color: "#1a5c3e",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>✅</span>
          Settings saved successfully. Changes are live.
        </div>
      )}
      {hasError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            backgroundColor: "#fff4f4",
            border: "1px solid #d82c0d",
            borderRadius: "10px",
            color: "#7c1c0a",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "18px" }}>❌</span>
          {actionData?.error || "An error occurred while saving."}
        </div>
      )}

      {/* Settings Form */}
      <Form method="post" noValidate>
        {/* Credentials Card */}
        <section
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "12px",
            padding: "24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            marginBottom: "20px",
          }}
        >
          <h2
            style={{
              margin: "0 0 6px 0",
              fontSize: "15px",
              fontWeight: 700,
              color: "#202223",
            }}
          >
            API Credentials
          </h2>
          <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#6d7175" }}>
            The master Trends API key is used when no region-specific key is set. Region-specific
            environment variables ({" "}
            <code
              style={{
                fontFamily: "monospace",
                fontSize: "12px",
                backgroundColor: "#f6f6f7",
                padding: "1px 4px",
                borderRadius: "4px",
              }}
            >
              TRENDS_API_KEY_NZ
            </code>{" "}
            etc.) still take priority.
          </p>

          {/* Trends API Key Field */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "4px" }}>
            <label
              htmlFor="trendsApiKey"
              style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}
            >
              Trends API Key
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                id="trendsApiKey"
                name="trendsApiKey"
                type={showKey ? "text" : "password"}
                defaultValue={trendsApiKey ?? ""}
                placeholder="Enter your Trends API Bearer token…"
                autoComplete="new-password"
                style={{
                  width: "100%",
                  padding: "9px 44px 9px 12px",
                  fontSize: "13px",
                  color: "#202223",
                  backgroundColor: "#fafbfb",
                  border: "1px solid #babfc3",
                  borderRadius: "8px",
                  outline: "none",
                  fontFamily: showKey ? "monospace" : "inherit",
                  letterSpacing: showKey ? "0" : "0.1em",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                aria-label={showKey ? "Hide API key" : "Reveal API key"}
                onClick={() => setShowKey((v) => !v)}
                style={{
                  position: "absolute",
                  right: "10px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6d7175",
                  fontSize: "16px",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {showKey ? "🙈" : "👁️"}
              </button>
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
              Stored securely in the database — never logged or exposed to the client.
            </p>
          </div>
        </section>

        {/* Active Regions Card */}
        <section
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "12px",
            padding: "24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            marginBottom: "20px",
          }}
        >
          <h2
            style={{
              margin: "0 0 6px 0",
              fontSize: "15px",
              fontWeight: 700,
              color: "#202223",
            }}
          >
            Active Regions
          </h2>
          <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#6d7175" }}>
            Enable or disable regional TRENDS catalogues. When only one region is active, the
            region switcher is hidden from the Product Catalog. At least one region must remain
            enabled at all times.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {ALL_REGIONS.map((region) => {
              const meta = REGION_META[region];
              const isActive = activeRegions.includes(region);
              const isLastActive = isActive && activeRegions.length === 1;

              return (
                <div
                  key={region}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 16px",
                    backgroundColor: isActive ? "#f3fdf7" : "#f9fafb",
                    borderRadius: "8px",
                    border: `1px solid ${isActive ? "#c2e5d9" : "#e1e3e5"}`,
                    transition: "all 0.15s ease",
                  }}
                >
                  {/* Hidden checkbox — the real form value */}
                  <input
                    type="checkbox"
                    name={`region_${region}`}
                    id={`region-toggle-${region}`}
                    checked={isActive}
                    onChange={() => toggleRegion(region)}
                    style={{ display: "none" }}
                    readOnly
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "22px" }}>{meta.flag}</span>
                    <div>
                      <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                        {meta.label}
                        <span
                          style={{
                            marginLeft: "8px",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#6d7175",
                            backgroundColor: "#f1f2f3",
                            padding: "1px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          {region.toUpperCase()} · {meta.currency}
                        </span>
                      </p>
                      {isLastActive && (
                        <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#d82c0d" }}>
                          ⚠️ Cannot disable — at least one region must remain active.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Toggle button */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    aria-label={`Toggle ${meta.label}`}
                    disabled={isLastActive}
                    onClick={() => toggleRegion(region)}
                    style={{
                      position: "relative",
                      width: "48px",
                      height: "26px",
                      borderRadius: "13px",
                      border: "none",
                      cursor: isLastActive ? "not-allowed" : "pointer",
                      transition: "background-color 0.2s ease",
                      backgroundColor: isActive ? "#008060" : "#babfc3",
                      flexShrink: 0,
                      opacity: isLastActive ? 0.6 : 1,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: "3px",
                        left: isActive ? "25px" : "3px",
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        backgroundColor: "#ffffff",
                        transition: "left 0.2s ease",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      }}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <p
            style={{
              margin: "14px 0 0 0",
              fontSize: "12px",
              color: "#6d7175",
              lineHeight: 1.5,
            }}
          >
            {activeRegions.length === 1
              ? `ℹ️ Only ${REGION_META[activeRegions[0]].label} is active — the region switcher will be hidden on the Product Catalog.`
              : `✅ ${activeRegions.length} regions active — the region switcher will be visible on the Product Catalog.`}
          </p>
        </section>

        {/* Fallback Behaviour Card */}
        <section
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "12px",
            padding: "24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            marginBottom: "20px",
          }}
        >
          <h2
            style={{
              margin: "0 0 6px 0",
              fontSize: "15px",
              fontWeight: 700,
              color: "#202223",
            }}
          >
            Fallback Behaviour
          </h2>
          <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#6d7175" }}>
            When enabled and API credentials are absent (or the upstream returns an error in
            development), the app returns realistic mock data instead of an error response.
          </p>

          {/* Hidden input for mock fallback value */}
          <input type="hidden" name="enableTrendsMockFallback" value={mockFallback ? "true" : "false"} />

          {/* Toggle Switch */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px",
              backgroundColor: "#f9fafb",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                Enable Mock Fallback
              </p>
              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6d7175" }}>
                Serves realistic mock catalogue data when credentials are missing or upstream fails.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={mockFallback}
              id="enableTrendsMockFallback-toggle"
              onClick={() => setMockFallback((v) => !v)}
              style={{
                position: "relative",
                width: "48px",
                height: "26px",
                borderRadius: "13px",
                border: "none",
                cursor: "pointer",
                transition: "background-color 0.2s ease",
                backgroundColor: mockFallback ? "#008060" : "#babfc3",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "3px",
                  left: mockFallback ? "25px" : "3px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "#ffffff",
                  transition: "left 0.2s ease",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </button>
          </div>

          <p
            style={{
              margin: "10px 0 0 0",
              fontSize: "12px",
              color: mockFallback ? "#008060" : "#6d7175",
              fontWeight: 500,
            }}
          >
            {mockFallback
              ? "✅ Mock fallback is enabled — safe for development and staging."
              : "⚠️ Mock fallback is disabled — a missing or invalid API key will return a 401 error."}
          </p>
        </section>

        {/* Save Button */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 24px",
              fontSize: "14px",
              fontWeight: 600,
              color: "#ffffff",
              backgroundColor: isSubmitting ? "#5c9e88" : "#008060",
              border: "none",
              borderRadius: "8px",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              transition: "background-color 0.15s ease",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
            }}
          >
            {isSubmitting ? (
              <>
                <span
                  style={{
                    width: "14px",
                    height: "14px",
                    border: "2px solid #ffffff",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "trends-spin 0.6s linear infinite",
                    display: "inline-block",
                  }}
                />
                Saving…
              </>
            ) : (
              <>💾 Save Settings</>
            )}
          </button>
        </div>
      </Form>

      {/* Info Card */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          padding: "16px 18px",
          backgroundColor: "#f6f6f7",
          borderRadius: "10px",
          border: "1px solid #e1e3e5",
        }}
      >
        <span style={{ fontSize: "18px", flexShrink: 0 }}>ℹ️</span>
        <div style={{ fontSize: "12px", color: "#6d7175", lineHeight: 1.6 }}>
          <strong style={{ color: "#202223" }}>Resolution priority for bearer token:</strong>{" "}
          Region-specific environment variable (e.g.{" "}
          <code
            style={{
              fontFamily: "monospace",
              fontSize: "11px",
              backgroundColor: "#ebebeb",
              padding: "1px 4px",
              borderRadius: "3px",
            }}
          >
            TRENDS_API_KEY_NZ
          </code>
          ) → <strong>this master key (DB)</strong> → generic{" "}
          <code
            style={{
              fontFamily: "monospace",
              fontSize: "11px",
              backgroundColor: "#ebebeb",
              padding: "1px 4px",
              borderRadius: "3px",
            }}
          >
            TRENDS_API_KEY
          </code>{" "}
          env var → basic auth env vars.
        </div>
      </div>
    </div>
  );
}
