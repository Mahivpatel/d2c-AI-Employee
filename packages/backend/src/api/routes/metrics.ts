import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { facts, syncLogs } from "../../db/schema";
import { and, eq, gte, sql, count, sum, max } from "drizzle-orm";
import { subDays } from "../../core/dateUtils";

const router = Router();

export const MetricsQuerySchema = z.object({
  merchantId: z.string().uuid(),
  periodDays: z.coerce.number().min(1).max(90).default(7),
});

router.get("/", async (req, res, next) => {
  try {
    const { merchantId, periodDays } = MetricsQuerySchema.parse(req.query);
    const since = subDays(new Date(), periodDays);

    // Revenue from Shopify orders
    const [revenueRow] = await db
      .select({
        total: sum(facts.amountInr),
        orderCount: count(facts.factId),
      })
      .from(facts)
      .where(
        and(
          eq(facts.merchantId, merchantId),
          eq(facts.source, "shopify"),
          eq(facts.entityType, "order"),
          gte(facts.occurredAt, since)
        )
      );

    // Ad spend from Meta
    const [spendRow] = await db
      .select({ total: sum(facts.amountInr) })
      .from(facts)
      .where(
        and(
          eq(facts.merchantId, merchantId),
          eq(facts.source, "meta_ads"),
          eq(facts.entityType, "ad_spend"),
          gte(facts.occurredAt, since)
        )
      );

    // Total shipments
    const [shipRow] = await db
      .select({ total: count(facts.factId) })
      .from(facts)
      .where(
        and(
          eq(facts.merchantId, merchantId),
          eq(facts.source, "shiprocket"),
          gte(facts.occurredAt, since)
        )
      );

    // RTO shipments — dimensions->>'is_rto' = 'true'
    const [rtoRow] = await db
      .select({ total: count(facts.factId) })
      .from(facts)
      .where(
        and(
          eq(facts.merchantId, merchantId),
          eq(facts.source, "shiprocket"),
          gte(facts.occurredAt, since),
          sql`${facts.dimensions}->>'is_rto' = 'true'`
        )
      );

    // Last sync times per connector
    const syncStatus = await db
      .select({
        connector: syncLogs.connector,
        lastSynced: max(syncLogs.completedAt),
      })
      .from(syncLogs)
      .where(
        and(eq(syncLogs.merchantId, merchantId), eq(syncLogs.status, "success"))
      )
      .groupBy(syncLogs.connector);

    const revenue = Number(revenueRow?.total ?? 0);
    const adSpend = Number(spendRow?.total ?? 0);
    const totalShipments = Number(shipRow?.total ?? 0);
    const rtoCount = Number(rtoRow?.total ?? 0);

    res.json({
      periodDays,
      revenueInr: Math.round(revenue * 100) / 100,
      orderCount: revenueRow?.orderCount ?? 0,
      adSpendInr: Math.round(adSpend * 100) / 100,
      roas: adSpend > 0 ? Math.round((revenue / adSpend) * 100) / 100 : null,
      rtoRatePct: totalShipments > 0
        ? Math.round((rtoCount / totalShipments) * 1000) / 10
        : 0,
      rtoCount,
      totalShipments,
      lastSynced: Object.fromEntries(syncStatus.map((s) => [s.connector, s.lastSynced])),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
