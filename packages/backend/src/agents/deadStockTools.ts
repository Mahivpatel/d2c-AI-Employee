// ── Dead Stock Agent — Groq tool definitions (OpenAI-compatible format) ────────
import type { Groq } from 'groq-sdk';

// Tool 1 — drill into a single SKU's sales history
export const skuDetailTool: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_sku_detail',
    description:
      'Fetch detailed sales history for a specific SKU over a custom time window',
    parameters: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'The SKU identifier to look up',
        },
        windowDays: {
          type: 'number',
          description: 'How many days of history to retrieve (e.g. 90)',
        },
      },
      required: ['sku', 'windowDays'],
    },
  },
};

// Tool 2 — check category-level seasonality for the Indian D2C market
export const seasonalityTool: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_category_seasonality',
    description:
      'Returns expected slow/peak months for a given product category in the Indian D2C market',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Product category e.g. "ethnic wear", "electronics", "home decor"',
        },
        month: {
          type: 'string',
          description: 'Current month name e.g. "April"',
        },
      },
      required: ['category', 'month'],
    },
  },
};

// Tool 3 — terminal tool: model submits its final structured proposals here
export const submitProposalsTool: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_dead_stock_proposals',
    description:
      'Submit the final list of dead stock proposals after completing analysis. Call this once when done.',
    parameters: {
      type: 'object',
      properties: {
        reasoning: {
          type: 'string',
          description: 'Brief summary of the evaluation, max 500 characters',
          maxLength: 500,
        },
        proposals: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              actionType: {
                type: 'string',
                enum: ['apply_discount', 'create_bundle', 'flag_liquidation'],
              },
              target: {
                type: 'object',
                properties: {
                  sku: { type: 'string' },
                  currentStock: { type: 'number' },
                  capitalLockedInr: { type: 'number' },
                  daysSinceLastSale: { type: 'number' },
                },
                required: [
                  'sku',
                  'currentStock',
                  'capitalLockedInr',
                  'daysSinceLastSale',
                ],
              },
              estimatedSavingInr: { type: 'number' },
              reasoning: {
                type: 'string',
                description: 'Concise reason, max 160 characters',
                maxLength: 160,
              },
              confidence: { type: 'number' },
              uncertaintyNote: {
                type: 'string',
                maxLength: 160,
              },
            },
            required: [
              'actionType',
              'target',
              'estimatedSavingInr',
              'reasoning',
              'confidence',
            ],
          },
        },
      },
      required: ['reasoning', 'proposals'],
    },
  },
};
