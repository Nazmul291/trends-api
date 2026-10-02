import type { Region } from "../../shared/types/trends.types";
import { REGION_CONFIGS } from "../../shared/types/trends.types";
import type { AppSettingsData } from "../settings/app-settings.service";

export interface RegionalAuthHeaders {
  baseUrl: string;
  headers: Record<string, string>;
  hasCredentials: boolean;
  authMethod: "bearer" | "basic" | "none";
}

/**
 * Checks whether valid API credentials exist for a given region.
 * Accepts resolved settings (from DB or env fallback) rather than reading
 * process.env directly — preventing leakage and enabling DB-driven config.
 *
 * Resolution order for bearer token:
 *   1. Region-specific env var  (TRENDS_API_KEY_NZ / TRENDS_BEARER_TOKEN_NZ)
 *   2. Master key from DB settings  (settings.trendsApiKey)
 *   3. Generic env var  (TRENDS_API_KEY)
 */
export function hasRegionalCredentials(region: Region, settings?: AppSettingsData | null): boolean {
  const upper = region.toUpperCase();
  const hasBearer = Boolean(
    process.env[`TRENDS_API_KEY_${upper}`] ||
    process.env[`TRENDS_BEARER_TOKEN_${upper}`] ||
    settings?.trendsApiKey ||
    process.env.TRENDS_API_KEY
  );

  const hasBasic = Boolean(
    (process.env[`TRENDS_API_USER_${upper}`] || process.env.TRENDS_API_USER) &&
    (process.env[`TRENDS_API_PASS_${upper}`] ||
      process.env[`TRENDS_API_PASSWORD_${upper}`] ||
      process.env.TRENDS_API_PASSWORD ||
      process.env.TRENDS_API_PASS)
  );

  return hasBearer || hasBasic;
}

/**
 * Resolves upstream API credentials and regional endpoint securely on the server.
 * Never exposes credentials to client-side bundles.
 *
 * @param region   - Target region (nz | au | sg)
 * @param settings - Resolved app settings (DB record or env fallback).
 *                   When omitted, falls back to environment variables only —
 *                   preserving backward-compat for call-sites not yet migrated.
 */
export function getRegionalUpstreamConfig(
  region: Region,
  settings?: AppSettingsData | null
): RegionalAuthHeaders {
  const config = REGION_CONFIGS[region] || REGION_CONFIGS.nz;
  const upperRegion = region.toUpperCase();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Trends-API-Shopify-Client/1.0",
  };

  // 1. Try Bearer Token
  //    Priority: region-specific env → DB master key → generic env
  const bearerToken =
    process.env[`TRENDS_API_KEY_${upperRegion}`] ||
    process.env[`TRENDS_BEARER_TOKEN_${upperRegion}`] ||
    settings?.trendsApiKey ||
    process.env.TRENDS_API_KEY;

  if (bearerToken && bearerToken.trim() !== "") {
    headers["Authorization"] = `Bearer ${bearerToken.trim()}`;
    return { baseUrl: config.url, headers, hasCredentials: true, authMethod: "bearer" };
  }

  // 2. Try Legacy Basic Authentication (env only — not exposed via UI intentionally)
  const basicUser =
    process.env[`TRENDS_API_USER_${upperRegion}`] || process.env.TRENDS_API_USER;
  const basicPass =
    process.env[`TRENDS_API_PASS_${upperRegion}`] ||
    process.env[`TRENDS_API_PASSWORD_${upperRegion}`] ||
    process.env.TRENDS_API_PASSWORD ||
    process.env.TRENDS_API_PASS;

  if (basicUser && basicPass) {
    const encoded = Buffer.from(`${basicUser.trim()}:${basicPass.trim()}`).toString("base64");
    headers["Authorization"] = `Basic ${encoded}`;
    return { baseUrl: config.url, headers, hasCredentials: true, authMethod: "basic" };
  }

  // 3. No credentials provided
  console.warn(
    `[TRENDS API Proxy] ⚠️ Warning: No API credentials found for region '${upperRegion}'. ` +
      `Configure the Trends API Key in the Settings page, or set TRENDS_API_KEY_${upperRegion} in .env.`
  );

  return { baseUrl: config.url, headers, hasCredentials: false, authMethod: "none" };
}
