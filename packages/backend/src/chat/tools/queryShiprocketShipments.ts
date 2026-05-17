import { tool } from 'ai';
import { z } from 'zod';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { resolveMerchantId } from './context';

const groupBySql: Record<string, any> = {
  total: sql<string>`'total'`,
  status: sql`dimensions->>'status'`,
  courier: sql`dimensions->>'courier'`,
  pincode: sql`dimensions->>'pincode'`,
  city: sql`dimensions->>'city'`,
  sku: sql`dimensions->>'sku'`,
  payment_method: sql`dimensions->>'payment_method'`,
  day: sql`date_trunc('day', occurred_at)::date::text`,
};

export const queryShiprocketShipments = tool({
  description: `Query Shiprocket shipment logistics: shipment count, freight, COD, delivered, in-transit, NDR, RTO, courier, city, pincode, SKU, payment method, and daily performance.
Use this for shipment analytics and RTO/NDR/COD/freight questions. Returns fact_ids that must appear in Shiprocket citations.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    date_from: z.string().describe('ISO 8601 date, e.g. 2026-05-01').optional(),
    date_to: z.string().describe('ISO 8601 date, e.g. 2026-05-31').optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    group_by: z.enum(['total', 'status', 'courier', 'pincode', 'city', 'sku', 'payment_method', 'day']).default('total'),
    status: z.string().optional(),
    courier: z.string().optional(),
    pincode: z.string().optional(),
    sku: z.string().optional(),
    payment_method: z.string().optional(),
    is_cod: z.boolean().optional(),
    is_rto: z.boolean().optional(),
    is_ndr: z.boolean().optional(),
    min_shipments: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  execute: async (args: any, options: any) => {
    const merchant_id = resolveMerchantId(args, options);
    let { date_from, date_to, start_date, end_date } = args;
    date_from = date_from || start_date;
    date_to = date_to || end_date;

    const groupBy = groupBySql[args.group_by ?? 'total'];
    const dateFilter =
      date_from && date_to
        ? sql`AND occurred_at >= ${date_from}::date
              AND occurred_at < (${date_to}::date + interval '1 day')`
        : date_from
          ? sql`AND occurred_at >= ${date_from}::date`
          : date_to
            ? sql`AND occurred_at < (${date_to}::date + interval '1 day')`
            : sql``;

    const statusFilter = args.status ? sql`AND lower(dimensions->>'status') = lower(${args.status})` : sql``;
    const courierFilter = args.courier ? sql`AND lower(dimensions->>'courier') = lower(${args.courier})` : sql``;
    const pincodeFilter = args.pincode ? sql`AND dimensions->>'pincode' = ${String(args.pincode)}` : sql``;
    const skuFilter = args.sku ? sql`AND lower(dimensions->>'sku') = lower(${args.sku})` : sql``;
    const paymentFilter = args.payment_method ? sql`AND lower(dimensions->>'payment_method') = lower(${args.payment_method})` : sql``;
    const codFilter = typeof args.is_cod === 'boolean' ? sql`AND dimensions->>'is_cod' = ${String(args.is_cod)}` : sql``;
    const rtoFilter = typeof args.is_rto === 'boolean' ? sql`AND dimensions->>'is_rto' = ${String(args.is_rto)}` : sql``;
    const ndrFilter = typeof args.is_ndr === 'boolean' ? sql`AND dimensions->>'is_ndr' = ${String(args.is_ndr)}` : sql``;

    const { rows } = await db.execute(sql`
      SELECT
        ${groupBy} AS bucket,
        COUNT(*)::int AS total_shipments,
        ROUND(SUM(amount_inr)::numeric, 2) AS freight_total_inr,
        ROUND(AVG(NULLIF(amount_inr, 0))::numeric, 2) AS avg_freight_inr,
        SUM(CASE WHEN dimensions->>'is_rto' = 'true' THEN 1 ELSE 0 END)::int AS rto_count,
        SUM(CASE WHEN dimensions->>'is_ndr' = 'true' THEN 1 ELSE 0 END)::int AS ndr_count,
        SUM(CASE
          WHEN lower(dimensions->>'status') LIKE '%delivered%'
           AND dimensions->>'is_rto' <> 'true'
          THEN 1 ELSE 0
        END)::int AS delivered_count,
        SUM(CASE WHEN lower(dimensions->>'status') LIKE '%transit%' THEN 1 ELSE 0 END)::int AS in_transit_count,
        SUM(CASE WHEN dimensions->>'is_cod' = 'true' THEN 1 ELSE 0 END)::int AS cod_count,
        ROUND(
          100.0 * SUM(CASE WHEN dimensions->>'is_rto' = 'true' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
          2
        ) AS rto_rate_pct,
        ROUND(
          100.0 * SUM(CASE WHEN dimensions->>'is_ndr' = 'true' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
          2
        ) AS ndr_rate_pct,
        ARRAY_AGG(fact_id::text) AS fact_ids
      FROM facts
      WHERE merchant_id = ${merchant_id}
        AND source = 'shiprocket'
        AND entity_type = 'shipment'
        ${dateFilter}
        ${statusFilter}
        ${courierFilter}
        ${pincodeFilter}
        ${skuFilter}
        ${paymentFilter}
        ${codFilter}
        ${rtoFilter}
        ${ndrFilter}
      GROUP BY 1
      HAVING COUNT(*) >= ${args.min_shipments ?? 1}
      ORDER BY total_shipments DESC, rto_rate_pct DESC
      LIMIT ${args.limit ?? 50}
    `);

    return {
      rows: rows as any[],
      total_fact_ids: rows.flatMap((r: any) => r.fact_ids ?? []),
      source: 'shiprocket',
      date_from,
      date_to,
      group_by: args.group_by ?? 'total',
    };
  },
});
