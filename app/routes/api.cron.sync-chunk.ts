import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { processSyncChunk } from "../../server/services/chunk-sync.service";

/**
 * Validates the request authorization against CRON_SECRET.
 * Vercel Cron sends HTTP GET requests with `Authorization: Bearer <CRON_SECRET>`.
 */
function verifyCronAuth(request: Request): { authorized: boolean; reason?: string } {
  const cronSecret = process.env.CRON_SECRET;

  // In local development or environments without CRON_SECRET configured, permit execution
  if (!cronSecret) {
    return { authorized: true };
  }

  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === cronSecret) {
      return { authorized: true };
    }
  }

  // Also support Vercel's x-vercel-cron-secret header or ?secret= query param
  const customHeader = request.headers.get("x-vercel-cron-secret");
  if (customHeader === cronSecret) {
    return { authorized: true };
  }

  const url = new URL(request.url);
  if (url.searchParams.get("secret") === cronSecret) {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: "Invalid or missing Bearer token in Authorization header matching CRON_SECRET.",
  };
}

/**
 * Common handler for processing a chunk synchronization pass.
 */
async function handleSyncChunk(request: Request) {
  const startTime = Date.now();

  // 1. Validate Cron Secret Authentication
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return Response.json(
      {
        success: false,
        error: "Unauthorized",
        message: auth.reason,
      },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const requestedShop = url.searchParams.get("shop");
  const forcedPageParam = url.searchParams.get("page");
  const chunkSizeParam = url.searchParams.get("size") || url.searchParams.get("limit");
  const isManual = url.searchParams.get("manual") === "true";

  const forcedPage = forcedPageParam ? parseInt(forcedPageParam, 10) : undefined;
  const chunkSize = chunkSizeParam ? Math.min(25, Math.max(1, parseInt(chunkSizeParam, 10))) : undefined;

  // 2. Identify Target Shop
  let targetShop: string | null = requestedShop;

  if (!targetShop) {
    // Pick the shop with autoSyncEnabled = true, prioritizing the one least recently processed
    const activeSetting = await prisma.appSettings.findFirst({
      where: { autoSyncEnabled: true },
      orderBy: { lastChunkProcessedAt: "asc" },
      select: { shop: true },
    });

    if (activeSetting) {
      targetShop = activeSetting.shop;
    } else {
      // Fallback to most recent session
      const session = await prisma.session.findFirst({
        orderBy: { id: "desc" },
        select: { shop: true },
      });
      targetShop = session?.shop || null;
    }
  }

  if (!targetShop) {
    return Response.json(
      {
        success: false,
        message: "No active shop or store settings found to process.",
        durationMs: Date.now() - startTime,
      },
      { status: 200 }
    );
  }

  // 3. Execute the single chunk synchronization
  const result = await processSyncChunk(targetShop, {
    forcedPage: Number.isInteger(forcedPage) && (forcedPage as number) > 0 ? forcedPage : undefined,
    chunkSize,
    isManual,
  });

  return Response.json(result, { status: 200 });
}

// Vercel Cron triggers HTTP GET requests
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleSyncChunk(request);
};

// Also support POST for manual triggers / testing
export const action = async ({ request }: ActionFunctionArgs) => {
  return handleSyncChunk(request);
};
