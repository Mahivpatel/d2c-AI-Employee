// ── Dead Stock Agent ───────────────────────────────────────────────────────────
// Orchestrates:
//  1. Data fetching (facts table via Drizzle)
//  2. Merchant context
//  3. Groq LLM reasoning loop (multi-turn tool use)
//  4. Idempotent run-log write to agent_runs table
//
// Entry point: runDeadStockAgent(input)

import { sql } from 'drizzle-orm';
import { and, eq } from 'drizzle-orm';
import { format } from 'date-fns';
import type Groq from 'groq-sdk';

import { db } from '../db/client';
import { merchants, agentRuns } from '../db/schema';
import { groq, GROQ_MODEL } from './groqClient';
import {
  skuDetailTool,
  seasonalityTool,
  submitProposalsTool,
} from './deadStockTools';
import {
  handleGetSkuDetail,
  handleGetCategorySeasonality,
} from './deadStockToolHandlers';
import type {
  DeadStockAgentInput,
  DeadStockProposal,
  MerchantContext,
  SkuSalesSummary,
} from './deadStockTypes';

// ── Helpers ────────────────────────────────────────────────────────────────────

function differenceInDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Data layer ─────────────────────────────────────────────────────────────────

async function fetchSkuSummaries(
  merchantId: string,
  lookbackDays: number
): Promise<SkuSalesSummary[]> {
  // Aggregate sales from real Shopify order payloads. The COALESCE fallback
  // keeps old local seed data working because that seed stored line_items in
  // dimensions before the Shopify connector was the source of truth.
  const salesResult = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(li->>'sku', ''), li->>'title') AS sku,
      MAX(li->>'title') AS product_title,
      SUM(
        CASE
          WHEN f.occurred_at >= NOW() - (${lookbackDays} || ' days')::interval
          THEN COALESCE((li->>'quantity')::numeric, 0)
          ELSE 0
        END
      ) AS units_sold_in_period,
      SUM(
        CASE
          WHEN f.occurred_at >= NOW() - (${lookbackDays} || ' days')::interval
          THEN COALESCE((li->>'quantity')::numeric, 0) * COALESCE((li->>'price')::numeric, 0)
          ELSE 0
        END
      ) AS revenue_in_period,
      MAX(f.occurred_at) AS last_sale_at
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
      AND COALESCE(NULLIF(li->>'sku', ''), li->>'title') IS NOT NULL
    GROUP BY COALESCE(NULLIF(li->>'sku', ''), li->>'title')
  `);

  // Latest real Shopify inventory snapshot per SKU. These rows are produced by
  // POST /api/sync with entity="inventory".
  const inventoryResult = await db.execute(sql`
    SELECT DISTINCT ON (dimensions->>'sku')
      dimensions->>'sku'                         AS sku,
      dimensions->>'product_title'               AS product_title,
      dimensions->>'product_type'                AS product_type,
      dimensions->>'vendor'                      AS vendor,
      dimensions->>'tags'                        AS tags,
      (dimensions->>'price')::float              AS price,
      (dimensions->>'quantity_available')::int   AS current_stock,
      (dimensions->>'cost_per_item')::float      AS cost_per_item,
      dimensions->>'cost_source'                 AS cost_source
    FROM facts
    WHERE
      merchant_id  = ${merchantId}::uuid
      AND source = 'shopify'
      AND entity_type = 'inventory'
      AND dimensions->>'sku' IS NOT NULL
    ORDER BY dimensions->>'sku', occurred_at DESC
  `);

  const salesRows = salesResult.rows as Array<{
    sku: string;
    product_title: string | null;
    units_sold_in_period: string;
    revenue_in_period: string;
    last_sale_at: string | null;
  }>;
  const inventoryRows = inventoryResult.rows as Array<{
    sku: string;
    product_title: string | null;
    product_type: string | null;
    vendor: string | null;
    tags: string | null;
    price: string | number | null;
    current_stock: string;
    cost_per_item: string;
    cost_source: string | null;
  }>;

  return inventoryRows.map((inv) => {
    const sale = salesRows.find((s) => s.sku === inv.sku);
    const currentStock = parseInt(inv.current_stock ?? '0', 10);
    const costPerItem = parseFloat(inv.cost_per_item ?? '0');
    const lastSaleAt = sale?.last_sale_at ?? null;

    return {
      sku: inv.sku,
      productTitle: inv.product_title ?? sale?.product_title ?? null,
      productType: inv.product_type,
      vendor: inv.vendor,
      tags: inv.tags,
      price: inv.price == null ? undefined : Number(inv.price),
      costSource: inv.cost_source,
      currentStock,
      costPerItem,
      capitalLockedInr: currentStock * costPerItem,
      unitsSoldInPeriod: sale ? parseInt(sale.units_sold_in_period ?? '0', 10) : 0,
      revenueInPeriod: sale ? Number(sale.revenue_in_period ?? 0) : 0,
      lastSaleAt,
      daysSinceLastSale: lastSaleAt
        ? differenceInDays(new Date(), new Date(lastSaleAt))
        : lookbackDays,
    };
  });
}

async function fetchMerchantContext(
  merchantId: string
): Promise<MerchantContext> {
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!merchant) {
    throw new Error(`Merchant not found: ${merchantId}`);
  }

  const velocityResult = await db.execute(sql`
    SELECT
      COUNT(*)        AS total_orders,
      AVG(amount_inr) AS avg_order_value
    FROM facts
    WHERE
      merchant_id  = ${merchantId}::uuid
      AND entity_type = 'order'
      AND occurred_at >= NOW() - INTERVAL '30 days'
  `);

  const row = velocityResult.rows[0] as {
    total_orders: string;
    avg_order_value: string;
  };

  return {
    // Fallback to a generic category if the merchants table doesn't have one yet
    category: (merchant as any).category ?? 'general',
    warehouseCostPerUnitPerDay: 2.40,
    currentMonth: format(new Date(), 'MMMM'),
    totalOrdersLast30Days: parseInt(row.total_orders ?? '0', 10),
    avgOrderValue: parseFloat(row.avg_order_value ?? '0'),
  };
}

// ── Groq reasoning loop ────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 8; // guard against infinite loops
const MAX_SKUS_FOR_LLM = 12;
const MAX_PROPOSALS_FOR_LLM = 5;
const MAX_COMPLETION_TOKENS = 1800;

function rankDeadStockCandidates(a: SkuSalesSummary, b: SkuSalesSummary): number {
  const aNoSales = a.unitsSoldInPeriod === 0 ? 1 : 0;
  const bNoSales = b.unitsSoldInPeriod === 0 ? 1 : 0;
  if (aNoSales !== bNoSales) return bNoSales - aNoSales;

  if (a.daysSinceLastSale !== b.daysSinceLastSale) {
    return b.daysSinceLastSale - a.daysSinceLastSale;
  }

  return b.capitalLockedInr - a.capitalLockedInr;
}

function compactSkuSummary(s: SkuSalesSummary) {
  return {
    sku: s.sku,
    title: s.productTitle,
    category: s.productType,
    stock: s.currentStock,
    cost: Math.round(s.costPerItem),
    costSource: s.costSource,
    capital: Math.round(s.capitalLockedInr),
    sold: s.unitsSoldInPeriod,
    revenue: Math.round(s.revenueInPeriod ?? 0),
    lastSaleAt: s.lastSaleAt,
    daysSinceLastSale: s.daysSinceLastSale,
  };
}

function chooseFallbackAction(s: SkuSalesSummary, lookbackDays: number): DeadStockProposal['actionType'] {
  if (s.unitsSoldInPeriod === 0 && s.daysSinceLastSale >= lookbackDays * 2) {
    return 'flag_liquidation';
  }

  if (s.unitsSoldInPeriod > 0 && s.currentStock > s.unitsSoldInPeriod * 4) {
    return 'create_bundle';
  }

  return 'apply_discount';
}

function buildFallbackProposals(
  skuSummaries: SkuSalesSummary[],
  context: MerchantContext,
  lookbackDays: number,
): { proposals: DeadStockProposal[]; reasoningChain: string; messages: Groq.Chat.ChatCompletionMessageParam[] } {
  const proposals = skuSummaries
    .slice()
    .sort(rankDeadStockCandidates)
    .slice(0, MAX_PROPOSALS_FOR_LLM)
    .map((s) => {
      const holdingCost30d = Math.round(s.currentStock * context.warehouseCostPerUnitPerDay * 30);
      const actionType = chooseFallbackAction(s, lookbackDays);
      const costNote = s.costSource === 'estimated_from_price'
        ? ' Cost is estimated.'
        : '';

      return {
        actionType,
        target: {
          sku: s.sku,
          currentStock: s.currentStock,
          capitalLockedInr: Math.round(s.capitalLockedInr),
          daysSinceLastSale: s.daysSinceLastSale,
        },
        estimatedSavingInr: holdingCost30d,
        reasoning:
          `${s.currentStock} units, ${s.unitsSoldInPeriod} sold in ${lookbackDays}d, ` +
          `${s.daysSinceLastSale}d since last sale.${costNote}`,
        confidence: s.costSource === 'estimated_from_price' ? 0.72 : 0.82,
        uncertaintyNote: s.costSource === 'estimated_from_price'
          ? 'Cost is estimated from Shopify variant price.'
          : undefined,
      };
    });

  return {
    proposals,
    reasoningChain:
      `Fallback rules used after LLM tool-call failure. Ranked by no recent sales, days since last sale, and capital locked. Generated ${proposals.length} proposals.`,
    messages: [
      {
        role: 'assistant',
        content: 'Fallback proposal generator used; no LLM message history available.',
      },
    ],
  };
}

async function runLLMReasoning(
  skuSummaries: SkuSalesSummary[],
  context: MerchantContext,
  merchantId: string,
  lookbackDays: number
): Promise<{ proposals: DeadStockProposal[]; reasoningChain: string; messages: Groq.Chat.ChatCompletionMessageParam[] }> {
  const llmSkuSummaries = skuSummaries
    .slice()
    .sort(rankDeadStockCandidates)
    .slice(0, MAX_SKUS_FOR_LLM)
    .map(compactSkuSummary);

  const systemPrompt = `You are an inventory analyst for a D2C brand in India.
Your job is to identify SKUs that represent a genuine capital problem and propose one concrete action per SKU.

The SKU table is computed from real Shopify data:
- currentStock, costPerItem, and capitalLockedInr come from the latest Shopify inventory snapshot
- unitsSoldInPeriod, revenueInPeriod, and lastSaleAt come from Shopify order line_items
- costSource tells you whether cost came from Shopify or an estimate from variant price

Rules:
- Do NOT flag SKUs just because they are slow movers
- Consider seasonality before flagging — use get_category_seasonality if uncertain
- Use get_sku_detail to drill into any SKU you want more history on
- Every proposal must reference specific data points from the SKU summaries
- Lower confidence and add uncertaintyNote when costSource is estimated_from_price
- Submit at most ${MAX_PROPOSALS_FOR_LLM} proposals; choose the highest capital risk SKUs
- Keep each proposal reasoning under 160 characters
- When done with your analysis, call submit_dead_stock_proposals with your final proposals
- Do NOT flag SKUs where capital locked is below ₹5,000 — not worth actioning`;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'user',
      content: `Merchant context:
- Category: ${context.category}
- Current month: ${context.currentMonth}
- Warehouse cost: ₹${context.warehouseCostPerUnitPerDay}/unit/day
- Total orders last 30 days: ${context.totalOrdersLast30Days}
- Avg order value: ₹${context.avgOrderValue.toFixed(2)}

SKU inventory + sales data (last ${lookbackDays} days):
${JSON.stringify(llmSkuSummaries)}

Analyse these top ${llmSkuSummaries.length} candidates selected from ${skuSummaries.length} actionable SKUs. Submit only the ${MAX_PROPOSALS_FOR_LLM} strongest actions.
When done, call submit_dead_stock_proposals with concise JSON.`,
    },
  ];

  let proposals: DeadStockProposal[] = [];
  let reasoningChain = '';
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round++;
    console.log(`[DeadStockAgent] LLM round ${round}/${MAX_TOOL_ROUNDS}`);

    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages,
      tools: [skuDetailTool, seasonalityTool, submitProposalsTool],
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: MAX_COMPLETION_TOKENS,
    });

    const message = response.choices[0].message;
    messages.push(message as Groq.Chat.ChatCompletionMessageParam);

    // No tool calls → model is done without submitting (graceful fallback)
    if (!message.tool_calls || message.tool_calls.length === 0) {
      reasoningChain = message.content ?? '';
      console.warn('[DeadStockAgent] Model returned without tool call — treating content as reasoning chain');
      break;
    }

    // Process all tool calls (Llama may call multiple in one turn)
    const toolResults: Groq.Chat.ChatCompletionToolMessageParam[] = [];

    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      console.log(`[DeadStockAgent] Tool call: ${toolCall.function.name}`, args);

      switch (toolCall.function.name) {
        case 'get_sku_detail': {
          const result = await handleGetSkuDetail(
            args.sku,
            args.windowDays,
            merchantId
          );
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
          break;
        }

        case 'get_category_seasonality': {
          const result = handleGetCategorySeasonality(args.category, args.month);
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
          break;
        }

        case 'submit_dead_stock_proposals': {
          // Terminal tool — capture and exit immediately
          proposals = (args.proposals ?? []).slice(0, MAX_PROPOSALS_FOR_LLM);
          reasoningChain = args.reasoning ?? '';
          console.log(
            `[DeadStockAgent] Proposals submitted — ${proposals.length} SKUs flagged`
          );
          return { proposals, reasoningChain, messages };
        }

        default: {
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: `Unknown tool: ${toolCall.function.name}`,
            }),
          });
        }
      }
    }

    // Append all tool results before next LLM round
    messages.push(...(toolResults as Groq.Chat.ChatCompletionMessageParam[]));
  }

  if (proposals.length === 0 && reasoningChain === '') {
    throw new Error(
      `LLM reasoning loop exhausted ${MAX_TOOL_ROUNDS} rounds without submitting proposals`
    );
  }

  return { proposals, reasoningChain, messages };
}

// ── Idempotency + run log ──────────────────────────────────────────────────────

async function writeRunLog(
  merchantId: string,
  input: DeadStockAgentInput,
  skuSummaries: SkuSalesSummary[],
  reasoningChain: string,
  proposals: DeadStockProposal[],
  messages: Groq.Chat.ChatCompletionMessageParam[]
): Promise<void> {
  // Filter out proposals that already have a pending_review entry for the same
  // SKU + actionType combination to avoid duplicates across daily runs.
  const deduped = await Promise.all(
    proposals.map(async (p) => {
      const existing = await db
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.merchantId, merchantId),
            eq(agentRuns.status, 'pending_review'),
            sql`proposals @> ${JSON.stringify([
              {
                target: { sku: p.target.sku },
                actionType: p.actionType,
              },
            ])}::jsonb`
          )
        )
        .limit(1);

      return existing.length > 0 ? null : p;
    })
  );

  const filtered = deduped.filter(Boolean) as DeadStockProposal[];

  if (filtered.length === 0) {
    console.log('[DeadStockAgent] All proposals already exist — skipping insert');
    return;
  }

  const avgConfidence =
    filtered.reduce((sum, p) => sum + p.confidence, 0) / filtered.length;

  await db.insert(agentRuns).values({
    merchantId,
    agentName: 'dead_stock',
    status: 'pending_review',
    inputsSnapshot: input as any,
    intermediateCalculations: {
      totalSkusAnalyzed: skuSummaries.length,
      totalSkusFlagged: filtered.length,
      skuSummaries,
      llmReasoningChain: reasoningChain,
      llmMessageHistory: messages,
      llmModel: GROQ_MODEL,
      llmProvider: 'groq',
      ranAt: new Date().toISOString(),
    } as any,
    proposals: filtered as any,
    confidenceScore: avgConfidence,
  });

  console.log(
    `[DeadStockAgent] Wrote agent_run — ${filtered.length} proposals (avg confidence ${avgConfidence.toFixed(2)})`
  );
}

// ── Public entry point ─────────────────────────────────────────────────────────

export async function runDeadStockAgent(
  input: DeadStockAgentInput
): Promise<{ proposalsCount: number; skusAnalyzed: number }> {
  const { merchantId, lookbackDays, minCapitalLockedInr } = input;

  console.log('[DeadStockAgent] Starting run for merchant', merchantId);

  const [skuSummaries, context] = await Promise.all([
    fetchSkuSummaries(merchantId, lookbackDays),
    fetchMerchantContext(merchantId),
  ]);

  console.log(`[DeadStockAgent] ${skuSummaries.length} SKUs loaded from inventory`);

  // Pre-filter: skip SKUs below capital threshold before even sending to LLM
  const actionableSummaries = skuSummaries.filter(
    (s) => s.capitalLockedInr >= minCapitalLockedInr
  );

  console.log(
    `[DeadStockAgent] ${actionableSummaries.length} SKUs above ₹${minCapitalLockedInr} threshold`
  );

  if (actionableSummaries.length === 0) {
    console.log('[DeadStockAgent] No actionable SKUs — skipping LLM call');
    return { proposalsCount: 0, skusAnalyzed: skuSummaries.length };
  }

  let proposals: DeadStockProposal[];
  let reasoningChain: string;
  let messages: Groq.Chat.ChatCompletionMessageParam[];

  try {
    ({ proposals, reasoningChain, messages } = await runLLMReasoning(
      actionableSummaries,
      context,
      merchantId,
      lookbackDays
    ));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[DeadStockAgent] LLM reasoning failed; using fallback proposals:', message);
    ({ proposals, reasoningChain, messages } = buildFallbackProposals(
      actionableSummaries,
      context,
      lookbackDays
    ));
  }

  await writeRunLog(
    merchantId,
    input,
    skuSummaries,
    reasoningChain,
    proposals,
    messages
  );

  return {
    proposalsCount: proposals.length,
    skusAnalyzed: skuSummaries.length,
  };
}
