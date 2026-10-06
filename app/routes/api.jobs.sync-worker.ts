import type { ActionFunctionArgs } from "react-router";
import type { ProductData, ProductShowData, Region } from "../../shared/types/trends.types";
import { TrendsApiClient } from "../../server/api-client/trends-client";
import { getAppSettings } from "../../server/settings/app-settings.service";
import { executeSyncJobAsync } from "../../server/services/sync-job.service";
import { getQStashReceiver, resolveSyncWorkerUrl } from "../../server/services/qstash.service";
import prisma from "../db.server";

interface SyncWorkerPayload {
  jobId: string;
  shop: string;
  trendsCode: string;
  region: Region;
  productToSync?: ProductData;
  syncLocks?: string[];
  isMock?: boolean;
  inventorySyncMode?: "single" | "split_equal";
  targetLocationId?: string | null;
  splitLocationIds?: string[];
}

/**
 * Dedicated internal worker invoked by Upstash QStash to execute the Shopify variant
 * sync pipeline. This route is never called by the browser/client — only by QStash's
 * delivery infrastructure (verified below) and, in local dev, the `qstash dev` CLI.
 *
 * QStash guarantees at-least-once delivery with its own retry/backoff schedule,
 * decoupled from the lifetime of the original request that queued the job. That's
 * what fixes the Vercel "mid-sync cutoff": this handler's own serverless invocation
 * is the thing doing the work, and it only resolves (letting the container freeze)
 * once the full sync has actually finished.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Entry log BEFORE anything else (body read, signature check) so Vercel's runtime
  // logs can confirm whether QStash's HTTP call is reaching this function at all. If
  // this line never appears for a published message, the request isn't arriving here
  // — look at the resolved worker URL logged in api.proxy.$.ts and whether it's
  // actually a publicly reachable Vercel domain (not a local/dev tunnel).
  console.info(
    `[SyncWorker] Incoming ${request.method} request from ${request.headers.get("user-agent") || "unknown"} ` +
      `(has upstash-signature: ${request.headers.has("upstash-signature")})`
  );

  const rawBody = await request.text();

  // 1. Verify the request genuinely came from QStash before trusting the payload.
  const receiver = getQStashReceiver();
  if (receiver) {
    const signature = request.headers.get("upstash-signature");
    if (!signature) {
      console.warn("[SyncWorker] Rejected request: missing upstash-signature header");
      return Response.json({ success: false, error: "Missing signature" }, { status: 401 });
    }

    try {
      const isValid = await receiver.verify({
        signature,
        body: rawBody,
        url: resolveSyncWorkerUrl(),
      });
      if (!isValid) {
        console.warn("[SyncWorker] Rejected request: signature verification returned false");
        return Response.json({ success: false, error: "Invalid signature" }, { status: 401 });
      }
    } catch (verifyErr) {
      console.warn("[SyncWorker] Rejected request: signature verification threw:", verifyErr);
      return Response.json({ success: false, error: "Invalid signature" }, { status: 401 });
    }
  } else {
    console.warn(
      "[SyncWorker] QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY not configured — " +
        "accepting request UNVERIFIED. Set both in production so only QStash can trigger syncs."
    );
  }

  let payload: SyncWorkerPayload;
  try {
    payload = JSON.parse(rawBody) as SyncWorkerPayload;
  } catch (parseErr) {
    console.error("[SyncWorker] Invalid JSON payload:", parseErr);
    return Response.json({ success: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const { jobId, shop, trendsCode, region } = payload;
  if (!jobId || !shop || !trendsCode || !region) {
    console.error("[SyncWorker] Missing required fields in payload:", payload);
    return Response.json({ success: false, error: "Missing required job fields" }, { status: 400 });
  }

  console.info(`[SyncWorker] Received job ${jobId} for product ${trendsCode} (shop: ${shop}, region: ${region})`);

  try {
    // 2. Resolve the full product payload, matching the previous inline-fetch fallback.
    let fullProduct = payload.productToSync;
    if (!fullProduct) {
      try {
        const appSettings = await getAppSettings(shop);
        const showRes = await TrendsApiClient.request<ProductShowData>(
          region,
          `products/${trendsCode}`,
          { settings: appSettings }
        );
        const rawShow = showRes.data?.data;
        fullProduct = Array.isArray(rawShow) ? rawShow[0] : rawShow;
      } catch (fetchErr) {
        console.warn(`[SyncWorker] Could not fetch product ${trendsCode} for job ${jobId}:`, fetchErr);
      }
    }

    if (!fullProduct) {
      fullProduct = {
        code: trendsCode,
        name: `Product ${trendsCode}`,
        description: "",
        categories: [],
        images: [],
        stock: [],
        pricing: [],
      } as ProductData;
    }

    // 3. Run the actual sync pipeline to completion inside this invocation.
    await executeSyncJobAsync(jobId, {
      shop,
      trendsCode,
      region,
      productToSync: fullProduct,
      syncLocks: payload.syncLocks,
      isMock: payload.isMock,
      inventorySyncMode: payload.inventorySyncMode,
      targetLocationId: payload.targetLocationId,
      splitLocationIds: payload.splitLocationIds,
    });

    // executeSyncJobAsync swallows its own errors and records them on the job row
    // rather than throwing, so check the persisted outcome to decide our HTTP status.
    const finalJob = await prisma.trendSyncJob.findUnique({
      where: { id: jobId },
      select: { status: true, errorMessage: true },
    });

    if (finalJob?.status === "FAILED") {
      console.error(`[SyncWorker] Job ${jobId} ended FAILED: ${finalJob.errorMessage}`);
      // 5xx so QStash applies its retry/backoff schedule.
      return Response.json(
        { success: false, jobId, error: finalJob.errorMessage || "Sync failed" },
        { status: 502 }
      );
    }

    console.info(`[SyncWorker] Job ${jobId} completed successfully.`);
    return Response.json({ success: true, jobId }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown worker error";
    console.error(`[SyncWorker] Unexpected error processing job ${jobId}:`, err);

    try {
      await prisma.trendSyncJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          stage: "FAILED",
          errorMessage: message,
          message: `Sync failed: ${message}`,
        },
      });
    } catch (dbErr) {
      console.error(`[SyncWorker] Failed to persist FAILED status for job ${jobId}:`, dbErr);
    }

    // 5xx (transient/critical) so QStash retries per its backoff schedule.
    return Response.json({ success: false, jobId, error: message }, { status: 500 });
  }
};
