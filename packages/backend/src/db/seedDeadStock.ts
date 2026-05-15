// ── Dead Stock Agent — Test Seed ───────────────────────────────────────────────
// Seeds 3 inventory + sales facts that cover the test cases in the spec.
//
// Seed 1 — genuinely dead, year-round category
//   DENIM-32-BLK: 340 units @ ₹480 = ₹163,200 locked, 89 days since last sale
//   Expected: flag_liquidation, high confidence
//   Groq check: should NOT call get_category_seasonality
//
// Seed 2 — slow but seasonal (ethnic wear in April)
//   KURTA-L-RED: 120 units @ ₹380 = ₹45,600 locked, 52 days since last sale
//   Expected: NOT flagged, or low confidence + uncertaintyNote
//   Groq check: should call get_category_seasonality('ethnic wear', 'April')
//
// Seed 3 — minor remnant, below capital threshold
//   SOCKS-M-WHT: 8 units @ ₹60 = ₹480 locked
//   Expected: ignored — below ₹5,000 threshold

import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema';

const MERCHANT_EMAIL = 'zara-demo@d2c.ai'; // seeded by db:seed

async function seedDeadStockFacts() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool, { schema });

  // Resolve merchant ID
  const merchantResult = await db.execute(sql`
    SELECT id FROM merchants WHERE email = ${MERCHANT_EMAIL} LIMIT 1
  `);

  if (merchantResult.rows.length === 0) {
    throw new Error(
      `Merchant not found: ${MERCHANT_EMAIL}. Run db:seed first.`
    );
  }

  const merchantId = (merchantResult.rows[0] as { id: string }).id;
  console.log('Seeding for merchant:', merchantId);

  const now = new Date();
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  // ── Inventory snapshots (entity_type = 'inventory') ───────────────────────
  const inventoryFacts = [
    {
      sku: 'DENIM-32-BLK',
      quantity_available: 340,
      cost_per_item: 480,
    },
    {
      sku: 'KURTA-L-RED',
      quantity_available: 120,
      cost_per_item: 380,
    },
    {
      sku: 'SOCKS-M-WHT',
      quantity_available: 8,
      cost_per_item: 60,
    },
  ];

  for (const inv of inventoryFacts) {
    await db.execute(sql`
      INSERT INTO facts (
        merchant_id, source, entity_type, connector_version,
        occurred_at, amount_inr, dimensions, raw_id, raw_payload
      ) VALUES (
        ${merchantId}::uuid,
        'shopify',
        'inventory',
        '1.0.0',
        ${now.toISOString()},
        0,
        ${JSON.stringify({
          sku: inv.sku,
          quantity_available: inv.quantity_available,
          cost_per_item: inv.cost_per_item,
        })}::jsonb,
        ${'inv-seed-' + inv.sku},
        '{}'::jsonb
      )
      ON CONFLICT (source, raw_id) DO NOTHING
    `);
    console.log(`Inventory seeded: ${inv.sku}`);
  }

  // ── Order facts with line_items (entity_type = 'order') ───────────────────
  // DENIM-32-BLK — last sale 89 days ago
  await db.execute(sql`
    INSERT INTO facts (
      merchant_id, source, entity_type, connector_version,
      occurred_at, amount_inr, dimensions, raw_id, raw_payload
    ) VALUES (
      ${merchantId}::uuid,
      'shopify',
      'order',
      '1.0.0',
      ${daysAgo(89)},
      16320,
      ${JSON.stringify({
        line_items: [{ sku: 'DENIM-32-BLK', quantity: 34 }],
      })}::jsonb,
      'order-seed-DENIM-32-BLK',
      '{}'::jsonb
    )
    ON CONFLICT (source, raw_id) DO NOTHING
  `);
  console.log('Order seeded: DENIM-32-BLK (89 days ago)');

  // KURTA-L-RED — last sale 52 days ago (seasonal: ethnic wear, April slow month)
  await db.execute(sql`
    INSERT INTO facts (
      merchant_id, source, entity_type, connector_version,
      occurred_at, amount_inr, dimensions, raw_id, raw_payload
    ) VALUES (
      ${merchantId}::uuid,
      'shopify',
      'order',
      '1.0.0',
      ${daysAgo(52)},
      45600,
      ${JSON.stringify({
        line_items: [{ sku: 'KURTA-L-RED', quantity: 120 }],
      })}::jsonb,
      'order-seed-KURTA-L-RED',
      '{}'::jsonb
    )
    ON CONFLICT (source, raw_id) DO NOTHING
  `);
  console.log('Order seeded: KURTA-L-RED (52 days ago)');

  // SOCKS-M-WHT — last sale 60 days ago (below capital threshold, should be ignored)
  await db.execute(sql`
    INSERT INTO facts (
      merchant_id, source, entity_type, connector_version,
      occurred_at, amount_inr, dimensions, raw_id, raw_payload
    ) VALUES (
      ${merchantId}::uuid,
      'shopify',
      'order',
      '1.0.0',
      ${daysAgo(60)},
      480,
      ${JSON.stringify({
        line_items: [{ sku: 'SOCKS-M-WHT', quantity: 8 }],
      })}::jsonb,
      'order-seed-SOCKS-M-WHT',
      '{}'::jsonb
    )
    ON CONFLICT (source, raw_id) DO NOTHING
  `);
  console.log('Order seeded: SOCKS-M-WHT (60 days ago)');

  await pool.end();
  console.log('\nDead stock test seed complete!');
  console.log('\nTest with:');
  console.log(
    `curl -X POST http://localhost:3000/api/agents/dead-stock/trigger \\`
  );
  console.log(`  -H 'Content-Type: application/json' \\`);
  console.log(`  -d '{"merchantId":"${merchantId}","lookbackDays":45,"minCapitalLockedInr":5000}'`);
}

seedDeadStockFacts().catch((err) => {
  console.error('Dead stock seed failed:', err);
  process.exit(1);
});
