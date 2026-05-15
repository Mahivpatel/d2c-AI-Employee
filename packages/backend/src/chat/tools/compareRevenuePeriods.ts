import { tool } from 'ai';
import { z }    from 'zod';
import { queryShopifyRevenue } from './queryShopifyRevenue';
import { resolveMerchantId } from './context';

export const compareRevenuePeriods = tool({
  description: `Compare Shopify revenue between two periods (WoW, MoM, custom).
    Use this for ANY question about changes, drops, or growth.
    Never subtract numbers yourself — always use this tool.`,
  inputSchema: z.object({
    merchant_id: z.string().optional(),
    period_a_from: z.string(), period_a_to: z.string(),
    period_b_from: z.string(), period_b_to: z.string(),
  }),
  execute: async (p: any, options: any) => {
    const merchant_id = resolveMerchantId(p, options);
    const revenueOptions = { experimental_context: { merchantId: merchant_id } };

    const [a, b] = await Promise.all([
      (queryShopifyRevenue as any).execute({
        date_from: p.period_a_from,
        date_to: p.period_a_to,
        group_by: 'total',
      }, revenueOptions),
      (queryShopifyRevenue as any).execute({
        date_from: p.period_b_from,
        date_to: p.period_b_to,
        group_by: 'total',
      }, revenueOptions),
    ]);
    const revA = Number(a.rows[0]?.revenue_inr ?? 0);
    const revB = Number(b.rows[0]?.revenue_inr ?? 0);
    return {
      period_a: { ...a.rows[0], label: `${p.period_a_from} to ${p.period_a_to}` },
      period_b: { ...b.rows[0], label: `${p.period_b_from} to ${p.period_b_to}` },
      delta_inr:     revB - revA,
      delta_pct:     revA > 0 ? ((revB - revA) / revA * 100).toFixed(1) : null,
      all_fact_ids:  [...a.total_fact_ids, ...b.total_fact_ids],
    };
  },
});
