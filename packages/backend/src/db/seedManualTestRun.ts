// ── Seed: Manual Test Agent Run ────────────────────────────────────────────────
// Seeds the exact agent_run produced by the manual test on 2026-05-15.
// Merchant: Zara India Demo (4925469e-7854-4e12-bab1-f5cb75b86079)
// Model: openai/gpt-oss-120b via Groq
// Proposals: DENIM-32-BLK + KURTA-L-RED — both apply_discount

import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

const MERCHANT_ID = '4925469e-7854-4e12-bab1-f5cb75b86079';

// Reconstructed from terminal logs of the manual test run
const testProposals = [
  {
    actionType: 'apply_discount',
    target: {
      sku: 'DENIM-32-BLK',
      currentStock: 340,
      capitalLockedInr: 163200,
      daysSinceLastSale: 45,
    },
    estimatedSavingInr: 24480,
    confidence: 0.92,
    reasoning:
      'DENIM-32-BLK has 340 units unsold for 45 days. No seasonality data suggests genuine demand weakness. Holding cost at ₹2.4/unit/day amounts to ₹24,480 per month. Applying a targeted discount (e.g., 20-30%) can stimulate sales and clear inventory within the next 30 days, eliminating the monthly holding cost and freeing ₹163,200 of capital.',
    uncertaintyNote:
      'Discount effectiveness depends on price elasticity; monitor conversion within first two weeks.',
  },
  {
    actionType: 'apply_discount',
    target: {
      sku: 'KURTA-L-RED',
      currentStock: 120,
      capitalLockedInr: 45600,
      daysSinceLastSale: 45,
    },
    estimatedSavingInr: 8640,
    confidence: 0.88,
    reasoning:
      'KURTA-L-RED has 120 units unsold for 45 days. Ethnic wear seasonality shows peak in Oct-Dec, making May off‑peak but not a designated slow month. However, zero sales indicate low current demand. Holding cost is ₹8,640 per month. A discount (e.g., 25%) can move inventory quickly, removing the holding cost and unlocking ₹45,600 capital.',
    uncertaintyNote:
      'Potential demand may improve closer to festive season; consider a time‑bound discount to avoid premature liquidation.',
  },
];

const testReasoningChain =
  'Both SKUs have zero sales over the past 45 days and are incurring significant warehouse costs (₹2.4 per unit per day). No strong seasonal demand is expected for denim, and while ethnic wear peaks later in the year, the current off‑peak period combined with zero sales signals genuine dead stock risk. Applying discounts is the least disruptive remediation, aiming to clear inventory within the next month, thereby saving the full monthly holding cost (₹24,480 for denim, ₹8,640 for kurta) and unlocking the tied capital. Confidence is high due to clear sales stagnation, with modest uncertainty around price elasticity and upcoming seasonal demand shifts.';

// Reconstructed tool-call message history from the terminal logs
const testMessageHistory = [
  {
    role: 'user',
    content:
      'Merchant context:\n- Category: general\n- Current month: May\n- Warehouse cost: ₹2.4/unit/day\n- Total orders last 30 days: 0\n- Avg order value: ₹0.00\n\nSKU inventory + sales data (last 45 days): [DENIM-32-BLK, KURTA-L-RED above ₹5,000 threshold]',
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_round1_seasonality_ethnic',
        type: 'function',
        function: {
          name: 'get_category_seasonality',
          arguments: JSON.stringify({ category: 'ethnic wear', month: 'May' }),
        },
      },
    ],
  },
  {
    role: 'tool',
    tool_call_id: 'call_round1_seasonality_ethnic',
    content: JSON.stringify({
      slowMonths: ['January', 'February', 'March', 'April'],
      peakMonths: ['October', 'November', 'December'],
      currentMonthIsSlow: false,
    }),
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_round2_seasonality_apparel',
        type: 'function',
        function: {
          name: 'get_category_seasonality',
          arguments: JSON.stringify({ category: 'apparel', month: 'May' }),
        },
      },
    ],
  },
  {
    role: 'tool',
    tool_call_id: 'call_round2_seasonality_apparel',
    content: JSON.stringify({
      slowMonths: [],
      peakMonths: [],
      note: 'No seasonality data for this category — treat slowness as a genuine signal',
      currentMonthIsSlow: false,
    }),
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_round3_submit',
        type: 'function',
        function: {
          name: 'submit_dead_stock_proposals',
          arguments: JSON.stringify({
            reasoning: testReasoningChain,
            proposals: testProposals,
          }),
        },
      },
    ],
  },
];

const avgConfidence =
  testProposals.reduce((s, p) => s + p.confidence, 0) / testProposals.length;

async function seedManualTestRun() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool, { schema });

  // Verify merchant exists
  const merchantCheck = await db.execute(sql`
    SELECT id, name FROM merchants WHERE id = ${MERCHANT_ID}::uuid LIMIT 1
  `);

  if (merchantCheck.rows.length === 0) {
    throw new Error(
      `Merchant ${MERCHANT_ID} not found. Run db:seed first.`
    );
  }

  const merchant = merchantCheck.rows[0] as { id: string; name: string };
  console.log(`Seeding agent_run for: ${merchant.name} (${merchant.id})`);

  await db.execute(sql`
    INSERT INTO agent_runs (
      merchant_id,
      agent_name,
      status,
      inputs_snapshot,
      intermediate_calculations,
      proposals,
      confidence_score,
      run_at
    ) VALUES (
      ${MERCHANT_ID}::uuid,
      'dead_stock',
      'pending_review',
      ${JSON.stringify({
        merchantId: MERCHANT_ID,
        lookbackDays: 45,
        minCapitalLockedInr: 5000,
      })}::jsonb,
      ${JSON.stringify({
        totalSkusAnalyzed: 3,
        totalSkusFlagged: 2,
        skuSummaries: [
          {
            sku: 'DENIM-32-BLK',
            currentStock: 340,
            costPerItem: 480,
            capitalLockedInr: 163200,
            unitsSoldInPeriod: 34,
            lastSaleAt: new Date(Date.now() - 89 * 86400000).toISOString(),
            daysSinceLastSale: 45,
          },
          {
            sku: 'KURTA-L-RED',
            currentStock: 120,
            costPerItem: 380,
            capitalLockedInr: 45600,
            unitsSoldInPeriod: 120,
            lastSaleAt: new Date(Date.now() - 52 * 86400000).toISOString(),
            daysSinceLastSale: 45,
          },
          {
            sku: 'SOCKS-M-WHT',
            currentStock: 8,
            costPerItem: 60,
            capitalLockedInr: 480,
            unitsSoldInPeriod: 8,
            lastSaleAt: new Date(Date.now() - 60 * 86400000).toISOString(),
            daysSinceLastSale: 45,
          },
        ],
        llmReasoningChain: testReasoningChain,
        llmMessageHistory: testMessageHistory,
        llmModel: 'openai/gpt-oss-120b',
        llmProvider: 'groq',
        ranAt: '2026-05-15T17:30:00.000Z',
      })}::jsonb,
      ${JSON.stringify(testProposals)}::jsonb,
      ${avgConfidence},
      '2026-05-15T17:30:00.000Z'
    )
  `);

  console.log('✅ Agent run seeded — 2 proposals (DENIM-32-BLK, KURTA-L-RED)');
  console.log(`   Avg confidence: ${avgConfidence.toFixed(2)}`);
  console.log('\nVerify with:');
  console.log(
    `curl "http://localhost:3000/api/agents?merchantId=${MERCHANT_ID}&status=pending_review"`
  );

  await pool.end();
}

seedManualTestRun().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
