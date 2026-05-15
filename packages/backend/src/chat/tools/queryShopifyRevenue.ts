import { tool } from 'ai';
import { z }    from 'zod';
import { db }   from '../../db';
import { sql } from 'drizzle-orm';
import { resolveMerchantId } from './context';

export const queryShopifyRevenue = tool({
  description: `Get Shopify order revenue and counts for a date range.
    ALWAYS call this before stating any revenue/order number.
    Returns fact_ids that must appear in your response citation.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    date_from:   z.string().describe('ISO 8601, e.g. 2024-05-01').optional(),
    date_to:     z.string().describe('ISO 8601, e.g. 2024-05-31').optional(),
    start_date:  z.string().optional(),
    end_date:    z.string().optional(),
    group_by:    z.enum(['day','week','month','total']).default('total'),
  }),
  execute: async (args: any, options: any) => {
    const merchant_id = resolveMerchantId(args, options);
    let { date_from, date_to, start_date, end_date, group_by } = args;
    date_from = date_from || start_date;
    date_to = date_to || end_date;

    const periodSql =
      group_by === 'total'
        ? sql<string>`'total'`
        : sql`date_trunc(${group_by}, occurred_at)`;

    const dateFilter =
      date_from && date_to
        ? sql`AND occurred_at >= ${date_from}::date
              AND occurred_at < (${date_to}::date + interval '1 day')`
        : date_from
          ? sql`AND occurred_at >= ${date_from}::date`
          : date_to
            ? sql`AND occurred_at < (${date_to}::date + interval '1 day')`
            : sql``;

    const { rows } = await db.execute(sql`
      SELECT
        ${periodSql} AS period,
        SUM(amount_inr)  AS revenue_inr,
        COUNT(*)         AS order_count,
        ROUND(AVG(amount_inr)) AS aov_inr,
        ARRAY_AGG(fact_id)   AS fact_ids
      FROM facts
      WHERE merchant_id  = ${merchant_id}
        AND source       = 'shopify'
        AND entity_type  = 'order'
        ${dateFilter}
        AND amount_inr   > 0
      GROUP BY 1
      ORDER BY 1
    `);

    return {
      rows: rows as any[],
      total_fact_ids: rows.flatMap((r: any) => r.fact_ids),
      date_from,
      date_to,
      source: 'shopify',
    };
  },
});
