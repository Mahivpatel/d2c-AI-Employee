// ── Dead Stock Agent — tool handler implementations ───────────────────────────
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

const MAX_SKU_DETAIL_ROWS = 50;

// ── get_sku_detail ─────────────────────────────────────────────────────────────
// Returns the per-order sales history for a given SKU within the window.
// Reads real Shopify order raw_payload.line_items, with a fallback for old seed
// data that stored line_items under dimensions.
export async function handleGetSkuDetail(
  sku: string,
  windowDays: number,
  merchantId: string
): Promise<string> {
  const result = await db.execute(sql`
    SELECT
      f.occurred_at,
      (li->>'quantity')::int AS qty,
      (li->>'price')::numeric AS price,
      li->>'title' AS title
    FROM facts f,
         jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(f.raw_payload->'line_items') = 'array'
               THEN f.raw_payload->'line_items'
             WHEN jsonb_typeof(f.dimensions->'line_items') = 'array'
               THEN f.dimensions->'line_items'
             ELSE '[]'::jsonb
           END
         ) AS li
    WHERE
      f.merchant_id  = ${merchantId}::uuid
      AND f.source = 'shopify'
      AND f.entity_type = 'order'
      AND f.occurred_at >= NOW() - (${windowDays} || ' days')::interval
      AND COALESCE(NULLIF(li->>'sku', ''), li->>'title') = ${sku}
    ORDER BY f.occurred_at DESC
  `);

  const rows = result.rows as Array<{
    occurred_at: string;
    qty: number;
    price: string | number | null;
    title: string | null;
  }>;
  const totalUnitsSold = rows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
  const revenueInr = rows.reduce(
    (sum, r) => sum + (Number(r.qty) || 0) * (Number(r.price) || 0),
    0,
  );

  return JSON.stringify({
    sku,
    totalRows: rows.length,
    totalUnitsSold,
    revenueInr: Math.round(revenueInr),
    recentSalesHistory: rows.slice(0, MAX_SKU_DETAIL_ROWS),
  });
}

// ── get_category_seasonality ──────────────────────────────────────────────────
// Hardcoded market knowledge for the Indian D2C space.
// Extend this lookup table or replace with a DB table as needed.
export function handleGetCategorySeasonality(
  category: string,
  month: string
): string {
  const seasonalityMap: Record<
    string,
    { slowMonths: string[]; peakMonths: string[] }
  > = {
    'ethnic wear': {
      slowMonths: ['January', 'February', 'March', 'April'],
      peakMonths: ['October', 'November', 'December'],
    },
    electronics: {
      slowMonths: ['June', 'July'],
      peakMonths: ['October', 'November'],
    },
    'home decor': {
      slowMonths: ['February', 'March'],
      peakMonths: ['October', 'November', 'December'],
    },
    fashion: {
      slowMonths: ['June', 'July'],
      peakMonths: ['October', 'November', 'December'],
    },
    footwear: {
      slowMonths: ['May', 'June'],
      peakMonths: ['October', 'November', 'December'],
    },
    'personal care': {
      slowMonths: [],
      peakMonths: ['October', 'November', 'December'],
    },
    'kitchen & dining': {
      slowMonths: ['January', 'February'],
      peakMonths: ['October', 'November', 'December'],
    },
  };

  const data = seasonalityMap[category.toLowerCase()] ?? {
    slowMonths: [],
    peakMonths: [],
    note: 'No seasonality data for this category — treat slowness as a genuine signal',
  };

  const isSlow = (data.slowMonths as string[]).includes(month);
  return JSON.stringify({ ...data, currentMonthIsSlow: isSlow });
}
