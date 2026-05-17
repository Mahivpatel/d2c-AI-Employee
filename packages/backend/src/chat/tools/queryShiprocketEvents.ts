import { tool } from 'ai';
import { z } from 'zod';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { resolveMerchantId } from './context';

const eventGroupBySql: Record<string, any> = {
  total: sql<string>`'total'`,
  reason: sql`dimensions->>'reason'`,
  status: sql`dimensions->>'status'`,
  courier: sql`dimensions->>'courier'`,
  pincode: sql`dimensions->>'pincode'`,
  day: sql`date_trunc('day', occurred_at)::date::text`,
};

export const queryShiprocketEvents = tool({
  description: `Query synced Shiprocket NDR, RTO, and tracking events. Use this for event reasons, failed-delivery causes, tracking statuses, and event trends.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    event_type: z.enum(['ndr_event', 'rto_event', 'tracking_event']).optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    group_by: z.enum(['total', 'reason', 'status', 'courier', 'pincode', 'day']).default('total'),
    status: z.string().optional(),
    reason: z.string().optional(),
    courier: z.string().optional(),
    pincode: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  execute: async (args: any, options: any) => {
    const merchant_id = resolveMerchantId(args, options);
    let { date_from, date_to, start_date, end_date } = args;
    date_from = date_from || start_date;
    date_to = date_to || end_date;

    const groupBy = eventGroupBySql[args.group_by ?? 'total'];
    const dateFilter =
      date_from && date_to
        ? sql`AND occurred_at >= ${date_from}::date
              AND occurred_at < (${date_to}::date + interval '1 day')`
        : date_from
          ? sql`AND occurred_at >= ${date_from}::date`
          : date_to
            ? sql`AND occurred_at < (${date_to}::date + interval '1 day')`
            : sql``;
    const eventTypeFilter = args.event_type
      ? sql`AND entity_type = ${args.event_type}`
      : sql`AND entity_type IN ('ndr_event', 'rto_event', 'tracking_event')`;
    const statusFilter = args.status ? sql`AND lower(dimensions->>'status') = lower(${args.status})` : sql``;
    const reasonFilter = args.reason ? sql`AND lower(dimensions->>'reason') LIKE ${`%${String(args.reason).toLowerCase()}%`}` : sql``;
    const courierFilter = args.courier ? sql`AND lower(dimensions->>'courier') = lower(${args.courier})` : sql``;
    const pincodeFilter = args.pincode ? sql`AND dimensions->>'pincode' = ${String(args.pincode)}` : sql``;

    const { rows } = await db.execute(sql`
      SELECT
        ${groupBy} AS bucket,
        COUNT(*)::int AS event_count,
        SUM(CASE WHEN entity_type = 'ndr_event' THEN 1 ELSE 0 END)::int AS ndr_event_count,
        SUM(CASE WHEN entity_type = 'rto_event' THEN 1 ELSE 0 END)::int AS rto_event_count,
        SUM(CASE WHEN entity_type = 'tracking_event' THEN 1 ELSE 0 END)::int AS tracking_event_count,
        ARRAY_AGG(fact_id::text) AS fact_ids
      FROM facts
      WHERE merchant_id = ${merchant_id}
        AND source = 'shiprocket'
        ${eventTypeFilter}
        ${dateFilter}
        ${statusFilter}
        ${reasonFilter}
        ${courierFilter}
        ${pincodeFilter}
      GROUP BY 1
      ORDER BY event_count DESC
      LIMIT ${args.limit ?? 50}
    `);

    return {
      rows: rows as any[],
      total_fact_ids: rows.flatMap((r: any) => r.fact_ids ?? []),
      source: 'shiprocket',
      event_type: args.event_type ?? 'all',
      date_from,
      date_to,
      group_by: args.group_by ?? 'total',
    };
  },
});
