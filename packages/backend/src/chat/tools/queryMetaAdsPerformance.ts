import { tool } from 'ai';
import { z } from 'zod';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { resolveMerchantId } from './context';

const groupBySql: Record<string, any> = {
  total: sql<string>`'total'`,
  campaign: sql`dimensions->>'campaign_name'`,
  ad_set: sql`dimensions->>'ad_set_name'`,
  ad: sql`dimensions->>'ad_name'`,
  day: sql`date_trunc('day', occurred_at)::date::text`,
};

const orderBySql: Record<string, any> = {
  spend_desc: sql`spend_inr DESC`,
  spend_asc: sql`spend_inr ASC`,
  revenue_desc: sql`revenue_inr DESC`,
  revenue_asc: sql`revenue_inr ASC`,
  roas_desc: sql`roas DESC NULLS LAST`,
  roas_asc: sql`roas ASC NULLS LAST`,
  clicks_desc: sql`clicks DESC`,
  purchases_desc: sql`purchases DESC`,
};

export const queryMetaAdsPerformance = tool({
  description: `Query Meta Ads spend, attributed revenue, ROAS, impressions, clicks, CTR, CPC, CPM, purchases, and cost per purchase.
Use this before stating any Meta Ads number, including worst/best ROAS, spend trends, ad/ad set/campaign performance, or acquisition efficiency.
Returns fact_ids that must appear in Meta Ads citations.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    date_from: z.string().describe('ISO 8601 date, e.g. 2025-05-01').optional(),
    date_to: z.string().describe('ISO 8601 date, e.g. 2025-05-09').optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    group_by: z.enum(['total', 'campaign', 'ad_set', 'ad', 'day']).default('campaign'),
    campaign_id: z.string().optional(),
    campaign_name: z.string().optional(),
    ad_set_id: z.string().optional(),
    ad_id: z.string().optional(),
    sort_by: z.enum([
      'spend_desc',
      'spend_asc',
      'revenue_desc',
      'revenue_asc',
      'roas_desc',
      'roas_asc',
      'clicks_desc',
      'purchases_desc',
    ]).default('roas_asc'),
    min_spend_inr: z.number().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  execute: async (args: any, options: any) => {
    const merchant_id = resolveMerchantId(args, options);
    let { date_from, date_to, start_date, end_date } = args;
    date_from = date_from || start_date;
    date_to = date_to || end_date;

    const groupBy = groupBySql[args.group_by ?? 'campaign'];
    const orderBy = orderBySql[args.sort_by ?? 'roas_asc'];

    const dateFilter =
      date_from && date_to
        ? sql`AND occurred_at >= ${date_from}::date
              AND occurred_at < (${date_to}::date + interval '1 day')`
        : date_from
          ? sql`AND occurred_at >= ${date_from}::date`
          : date_to
            ? sql`AND occurred_at < (${date_to}::date + interval '1 day')`
            : sql``;

    const campaignIdFilter = args.campaign_id
      ? sql`AND dimensions->>'campaign_id' = ${args.campaign_id}`
      : sql``;
    const campaignNameFilter = args.campaign_name
      ? sql`AND lower(dimensions->>'campaign_name') = lower(${args.campaign_name})`
      : sql``;
    const adSetFilter = args.ad_set_id
      ? sql`AND dimensions->>'ad_set_id' = ${args.ad_set_id}`
      : sql``;
    const adFilter = args.ad_id
      ? sql`AND dimensions->>'ad_id' = ${args.ad_id}`
      : sql``;

    const { rows } = await db.execute(sql`
      WITH grouped AS (
        SELECT
          ${groupBy} AS bucket,
          SUM(CASE WHEN entity_type = 'ad_spend' THEN amount_inr ELSE 0 END) AS spend_inr,
          SUM(CASE WHEN entity_type = 'ad_attributed_revenue' THEN amount_inr ELSE 0 END) AS revenue_inr,
          SUM(CASE WHEN entity_type = 'ad_spend' THEN COALESCE((dimensions->>'impressions')::numeric, 0) ELSE 0 END) AS impressions,
          SUM(CASE WHEN entity_type = 'ad_spend' THEN COALESCE((dimensions->>'reach')::numeric, 0) ELSE 0 END) AS reach,
          SUM(CASE WHEN entity_type = 'ad_spend' THEN COALESCE((dimensions->>'clicks')::numeric, 0) ELSE 0 END) AS clicks,
          SUM(CASE WHEN entity_type = 'ad_spend' THEN COALESCE((dimensions->>'unique_clicks')::numeric, 0) ELSE 0 END) AS unique_clicks,
          SUM(CASE WHEN entity_type = 'ad_spend' THEN COALESCE((dimensions->>'purchases')::numeric, 0) ELSE 0 END) AS purchases,
          SUM(CASE WHEN entity_type = 'ad_spend' THEN COALESCE((dimensions->>'add_to_carts')::numeric, 0) ELSE 0 END) AS add_to_carts,
          ARRAY_AGG(fact_id::text) AS fact_ids
        FROM facts
        WHERE merchant_id = ${merchant_id}
          AND source = 'meta_ads'
          AND entity_type IN ('ad_spend', 'ad_attributed_revenue')
          ${dateFilter}
          ${campaignIdFilter}
          ${campaignNameFilter}
          ${adSetFilter}
          ${adFilter}
        GROUP BY 1
      )
      SELECT
        bucket,
        ROUND(spend_inr::numeric, 2) AS spend_inr,
        ROUND(revenue_inr::numeric, 2) AS revenue_inr,
        ROUND((revenue_inr / NULLIF(spend_inr, 0))::numeric, 2) AS roas,
        impressions::int AS impressions,
        reach::int AS reach,
        clicks::int AS clicks,
        unique_clicks::int AS unique_clicks,
        purchases::int AS purchases,
        add_to_carts::int AS add_to_carts,
        ROUND((100.0 * clicks / NULLIF(impressions, 0))::numeric, 2) AS ctr_pct,
        ROUND((spend_inr / NULLIF(clicks, 0))::numeric, 2) AS cpc_inr,
        ROUND((1000.0 * spend_inr / NULLIF(impressions, 0))::numeric, 2) AS cpm_inr,
        ROUND((spend_inr / NULLIF(purchases, 0))::numeric, 2) AS cost_per_purchase_inr,
        fact_ids
      FROM grouped
      WHERE spend_inr >= ${args.min_spend_inr ?? 0}
      ORDER BY ${orderBy}
      LIMIT ${args.limit ?? 50}
    `);

    return {
      rows: rows as any[],
      total_fact_ids: rows.flatMap((r: any) => r.fact_ids ?? []),
      source: 'meta_ads',
      date_from,
      date_to,
      group_by: args.group_by ?? 'campaign',
      sort_by: args.sort_by ?? 'roas_asc',
    };
  },
});
