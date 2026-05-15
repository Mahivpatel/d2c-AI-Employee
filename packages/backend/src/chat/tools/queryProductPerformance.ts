import { tool } from 'ai';
import { z }    from 'zod';
import { db }   from '../../db';
import { sql } from 'drizzle-orm';
import { resolveMerchantId } from './context';

export const queryProductPerformance = tool({
  description: `Revenue + units sold per SKU/product. Rank top/bottom N. Returns fact_ids per product.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    date_from:   z.string().describe('ISO 8601, e.g. 2024-05-01').optional(),
    date_to:     z.string().describe('ISO 8601, e.g. 2024-05-31').optional(),
    start_date:  z.string().optional(),
    end_date:    z.string().optional(),
    limit:       z.number().default(10),
    sort_by:     z.enum(['revenue', 'units']).default('revenue'),
    order:       z.enum(['desc', 'asc']).default('desc'),
  }),
  execute: async (args: any, options: any) => {
    const merchant_id = resolveMerchantId(args, options);
    let { date_from, date_to, start_date, end_date, limit, sort_by, order } = args;
    date_from = date_from || start_date;
    date_to = date_to || end_date;
    const orderByColumn = sort_by === 'revenue' ? sql`revenue_inr` : sql`units_sold`;
    const orderDirection = order === 'asc' ? sql`ASC` : sql`DESC`;

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
        COALESCE(line_item->>'sku', line_item->>'title') AS sku,
        MAX(line_item->>'title') AS product_title,
        SUM((line_item->>'price')::numeric * (line_item->>'quantity')::numeric * fx_rate_used) AS revenue_inr,
        SUM((line_item->>'quantity')::numeric) AS units_sold,
        ARRAY_AGG(DISTINCT fact_id) AS fact_ids
      FROM facts,
      jsonb_array_elements(raw_payload->'line_items') AS line_item
      WHERE merchant_id = ${merchant_id}
        AND source = 'shopify'
        AND entity_type = 'order'
        ${dateFilter}
      GROUP BY 1
      ORDER BY ${orderByColumn} ${orderDirection}
      LIMIT ${limit ?? 10}
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
