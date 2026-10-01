import type { Region } from "../../shared/types/trends.types";
import { REGION_CONFIGS } from "../../shared/types/trends.types";

export interface RegionalAuthHeaders {
  baseUrl: string;
  headers: Record<string, string>;
  hasCredentials: boolean;
  authMethod: "bearer" | "basic" | "none";
}

/**
 * Checks whether valid API credentials exist for a given region in environment variables.
 */
export function hasRegionalCredentials(region: Region): boolean {
  const upper = region.toUpperCase();
  const hasBearer = Boolean(
    process.env[`TRENDS_API_KEY_${upper}`] ||
    process.env[`TRENDS_BEARER_TOKEN_${upper}`] ||
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
 */
export function getRegionalUpstreamConfig(region: Region): RegionalAuthHeaders {
  const config = REGION_CONFIGS[region] || REGION_CONFIGS.nz;
  const upperRegion = region.toUpperCase();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Trends-API-Shopify-Client/1.0",
  };

  // 1. Try Bearer Token (Specific region env, fallback to generic)
  const bearerToken =
    process.env[`TRENDS_API_KEY_${upperRegion}`] ||
    process.env[`TRENDS_BEARER_TOKEN_${upperRegion}`] ||
    process.env.TRENDS_API_KEY;

  if (bearerToken && bearerToken.trim() !== "") {
    headers["Authorization"] = `Bearer ${bearerToken.trim()}`;
    return { baseUrl: config.url, headers, hasCredentials: true, authMethod: "bearer" };
  }

  // 2. Try Legacy Basic Authentication
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
      `Configure TRENDS_API_KEY_${upperRegion} or legacy basic auth in .env.`
  );

  return { baseUrl: config.url, headers, hasCredentials: false, authMethod: "none" };
}
