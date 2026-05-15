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
  // Aggregate sales from order facts
  // Use an implicit lateral join to expand line_items BEFORE aggregating.
  // jsonb_array_elements is a set-returning function and cannot be nested
  // inside SUM() / MAX() — Postgres raises "aggregate function calls cannot
  // contain set-returning function calls" if you try.
  const salesResult = await db.execute(sql`
    SELECT
      li->>'sku'            AS sku,
      SUM((li->>'quantity')::int) AS units_sold,
      MAX(f.occurred_at)   AS last_sale_at
    FROM facts f,
         jsonb_array_elements(f.dimensions->'line_items') AS li
    WHERE
      f.merchant_id  = ${merchantId}::uuid
      AND f.entity_type = 'order'
      AND f.occurred_at >= NOW() - (${lookbackDays} || ' days')::interval
    GROUP BY li->>'sku'
  `);

  // Latest inventory snapshot per SKU
  const inventoryResult = await db.execute(sql`
    SELECT DISTINCT ON (dimensions->>'sku')
      dimensions->>'sku'                         AS sku,
      (dimensions->>'quantity_available')::int   AS current_stock,
      (dimensions->>'cost_per_item')::float      AS cost_per_item
    FROM facts
    WHERE
      merchant_id  = ${merchantId}::uuid
      AND entity_type = 'inventory'
    ORDER BY dimensions->>'sku', occurred_at DESC
  `);

  const salesRows = salesResult.rows as Array<{
    sku: string;
    units_sold: string;
    last_sale_at: string | null;
  }>;
  const inventoryRows = inventoryResult.rows as Array<{
    sku: string;
    current_stock: string;
    cost_per_item: string;
  }>;

  return inventoryRows.map((inv) => {
    const sale = salesRows.find((s) => s.sku === inv.sku);
    const currentStock = parseInt(inv.current_stock ?? '0', 10);
    const costPerItem = parseFloat(inv.cost_per_item ?? '0');

    return {
      sku: inv.sku,
      currentStock,
      costPerItem,
      capitalLockedInr: currentStock * costPerItem,
      unitsSoldInPeriod: sale ? parseInt(sale.units_sold, 10) : 0,
      lastSaleAt: sale?.last_sale_at ?? null,
      daysSinceLastSale: sale?.last_sale_at
        ? differenceInDays(new Date(), new Date(sale.last_sale_at))
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

async function runLLMReasoning(
  skuSummaries: SkuSalesSummary[],
  context: MerchantContext,
  merchantId: string,
  lookbackDays: number
): Promise<{ proposals: DeadStockProposal[]; reasoningChain: string; messages: Groq.Chat.ChatCompletionMessageParam[] }> {
  const systemPrompt = `You are an inventory analyst for a D2C brand in India.
Your job is to identify SKUs that represent a genuine capital problem and propose one concrete action per SKU.

Rules:
- Do NOT flag SKUs just because they are slow movers
- Consider seasonality before flagging — use get_category_seasonality if uncertain
- Use get_sku_detail to drill into any SKU you want more history on
- Every proposal must reference specific data points from the SKU summaries
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
${JSON.stringify(skuSummaries, null, 2)}

Analyse this inventory. Use the available tools to investigate further where needed.
When you have completed your analysis, submit your proposals via submit_dead_stock_proposals.`,
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
      max_tokens: 4096,
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
          proposals = args.proposals ?? [];
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

  const { proposals, reasoningChain, messages } = await runLLMReasoning(
    actionableSummaries,
    context,
    merchantId,
    lookbackDays
  );

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
