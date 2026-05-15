// ── Dead Stock Agent — tool handler implementations ───────────────────────────
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

// ── get_sku_detail ─────────────────────────────────────────────────────────────
// Returns the per-order sales history for a given SKU within the window.
// Uses JSONB containment (@>) to filter by SKU inside line_items array.
export async function handleGetSkuDetail(
  sku: string,
  windowDays: number,
  merchantId: string
): Promise<string> {
  const result = await db.execute(sql`
    SELECT
      f.occurred_at,
      (li->>'quantity')::int AS qty
    FROM facts f,
         jsonb_array_elements(f.dimensions->'line_items') AS li
    WHERE
      f.merchant_id  = ${merchantId}::uuid
      AND f.entity_type = 'order'
      AND f.occurred_at >= NOW() - (${windowDays} || ' days')::interval
      AND li->>'sku' = ${sku}
    ORDER BY f.occurred_at DESC
  `);

  const rows = result.rows as Array<{ occurred_at: string; qty: number }>;
  const totalUnitsSold = rows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

  return JSON.stringify({ sku, salesHistory: rows, totalUnitsSold });
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
