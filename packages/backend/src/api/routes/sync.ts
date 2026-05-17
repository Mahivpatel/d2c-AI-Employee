// ── POST /api/sync ────────────────────────────────────────────────────────────
// Triggers a full connector fetch + upsert for a given merchant/entity.
// Supports both read (fetch) and write (execute approved AgentRun proposals).
//
// POST /api/sync          { merchantId, connector, entity, filters? }
// POST /api/sync/write    { merchantId, connector, entity, payload }

import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { syncLogs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ShopifyConnector } from "../../connectors/shopify";
import { ShiprocketConnector } from "../../connectors/shiprocket";
import { MetaAdsConnector } from "../../connectors/metaAds";
import { upsertFacts } from "../../connectors/upsert";
import { BaseConnector } from "../../connectors/base";

const router = Router();

// ── Shared: resolve connector by name ─────────────────────────────────────────

function resolveConnector(connector: string): BaseConnector {
  switch (connector) {
    case "shopify":
      return new ShopifyConnector();
    case "shiprocket":
      return new ShiprocketConnector();
    case "meta_ads":
      return new MetaAdsConnector();
    default:
      throw new Error(`Unknown connector: "${connector}". Supported: shopify, meta_ads, shiprocket.`);
  }
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const FetchRequestSchema = z.object({
  merchantId: z.string().uuid(),
  connector:  z.enum(["shopify", "meta_ads", "shiprocket"]),
  entity:     z.string().min(1),
  filters:    z
    .object({
      dateFrom: z.string().datetime().optional(),
      dateTo:   z.string().datetime().optional(),
      limit:    z.number().int().positive().max(250).optional(),
      sinceId:  z.string().optional(),
      status:   z.string().optional(),
      campaign_id: z.string().optional(),
      ad_set_id: z.string().optional(),
      ad_id: z.string().optional(),
    })
    .optional(),
});

const WriteRequestSchema = z.object({
  merchantId: z.string().uuid(),
  connector:  z.enum(["shopify", "meta_ads", "shiprocket"]),
  entity:     z.string().min(1),
  payload:    z.record(z.string(), z.unknown()),
});

// ── POST /api/sync — fetch & upsert ──────────────────────────────────────────

router.post("/", async (req, res, next) => {
  let logId: number | undefined;

  try {
    const body = FetchRequestSchema.parse(req.body);

    // Open a sync_log row
    const [log] = await db
      .insert(syncLogs)
      .values({
        merchantId: body.merchantId,
        connector:  body.connector,
        status:     "running",
      })
      .returning({ id: syncLogs.id });
    logId = log.id;

    // Resolve and authenticate connector
    const connector = resolveConnector(body.connector);
    await connector.authenticate();

    // Parse date filters (string → Date)
    const filters = body.filters
      ? {
          ...body.filters,
          dateFrom: body.filters.dateFrom ? new Date(body.filters.dateFrom) : undefined,
          dateTo:   body.filters.dateTo   ? new Date(body.filters.dateTo)   : undefined,
        }
      : {};

    // Fetch normalized facts
    const facts = await connector.fetch(body.entity, filters);

    // Upsert into facts table
    const result = await upsertFacts(body.merchantId, facts);

    // Mark sync_log success
    await db
      .update(syncLogs)
      .set({
        status:       "success",
        completedAt:  new Date(),
        rowsUpserted: result.attempted,
      })
      .where(eq(syncLogs.id, logId));

    res.json({
      status:      "success",
      logId,
      attempted:   result.attempted,
      connector:   body.connector,
      entity:      body.entity,
      merchantId:  body.merchantId,
    });
  } catch (err) {
    // Mark sync_log failed (if we managed to create one)
    if (logId !== undefined) {
      await db
        .update(syncLogs)
        .set({
          status:       "failed",
          completedAt:  new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        .where(eq(syncLogs.id, logId))
        .catch(() => {/* best-effort */});
    }
    next(err);
  }
});

// ── POST /api/sync/write — execute approved mutation ─────────────────────────
// Called only after an AgentRun has been approved (status = "approved").
// The caller must supply the full payload including action + order_id.

router.post("/write", async (req, res, next) => {
  try {
    const body = WriteRequestSchema.parse(req.body);

    const connector = resolveConnector(body.connector);
    await connector.authenticate();

    const result = await connector.write(body.entity, body.payload);

    res.json({
      status:    "ok",
      connector: body.connector,
      entity:    body.entity,
      result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
