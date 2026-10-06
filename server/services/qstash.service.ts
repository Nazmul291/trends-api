/**
 * QStash Service
 *
 * Provides the Upstash QStash client used to dispatch Shopify sync jobs as durable
 * HTTP messages, plus the URL-resolution helpers needed to address our own worker
 * route from any deployment (local dev, Vercel preview, Vercel production).
 *
 * This replaces the previous `context.waitUntil`-based fire-and-forget background
 * promise in app/routes/api.proxy.$.ts: that promise had no actual lifecycle
 * guarantee on Vercel (the function container freezes right after the HTTP
 * response is sent), so long-running variant syncs were getting cut off mid-way.
 * QStash instead delivers the job as a real HTTP POST to a dedicated worker route,
 * with its own retry/backoff policy independent of the triggering request's lifetime.
 */

import { Client, Receiver } from "@upstash/qstash";

let client: Client | null = null;

/** Lazily constructs (and caches) the QStash publishing client. */
export function getQStashClient(): Client {
  if (!client) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) {
      throw new Error("QSTASH_TOKEN is not configured");
    }
    // QSTASH_URL lets this point at a custom/self-hosted QStash endpoint (e.g. the
    // local `qstash dev` CLI). Falls back to the Client's own default
    // (https://qstash.upstash.io) when unset.
    const baseUrl = process.env.QSTASH_URL;
    client = new Client({ token, ...(baseUrl ? { baseUrl } : {}) });
  }
  return client;
}

let receiver: Receiver | null | undefined;

/**
 * Lazily constructs (and caches) the QStash signature receiver used to verify that
 * incoming worker requests actually originated from QStash. Returns `null` when the
 * signing keys aren't configured (e.g. local development without a tunnel), in which
 * case callers should treat the request as unverified rather than throwing.
 */
export function getQStashReceiver(): Receiver | null {
  if (receiver === undefined) {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

    receiver =
      currentSigningKey && nextSigningKey ? new Receiver({ currentSigningKey, nextSigningKey }) : null;
  }
  return receiver;
}

/**
 * Resolves the publicly reachable base URL for this deployment so QStash can call
 * back into our own worker route. Prefers the explicitly configured app URL (stable
 * custom domain), falling back to Vercel's auto-generated deployment URL.
 */
export function resolveAppBaseUrl(): string {
  const configured = process.env.SHOPIFY_APP_URL || process.env.HOST;
  if (configured) return configured.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  throw new Error(
    "Unable to resolve app base URL for QStash callback: set SHOPIFY_APP_URL (or rely on Vercel's VERCEL_URL)"
  );
}

/** The dedicated internal endpoint QStash delivers sync jobs to. */
export function resolveSyncWorkerUrl(): string {
  return `${resolveAppBaseUrl()}/api/jobs/sync-worker`;
}
