// ── API Schema barrel ─────────────────────────────────────────────────────────
// Re-exports all Zod request/response schemas for documentation and testing.

export { ChatRequestSchema } from "../routes/chat";
export { MetricsQuerySchema } from "../routes/metrics";
// sync.ts schemas are not exported from route file — re-declare here for docs
import { z } from "zod";

export const SyncFetchRequestSchema = z.object({
  merchantId: z.string().uuid(),
  connector:  z.enum(["shopify", "meta_ads", "shiprocket"]),
  entity:     z.string().min(1),
  filters: z.object({
    dateFrom: z.string().datetime().optional(),
    dateTo:   z.string().datetime().optional(),
    limit:    z.number().int().positive().max(250).optional(),
    sinceId:  z.string().optional(),
    status:   z.string().optional(),
  }).optional(),
});

export const SyncWriteRequestSchema = z.object({
  merchantId: z.string().uuid(),
  connector:  z.enum(["shopify", "meta_ads", "shiprocket"]),
  entity:     z.string().min(1),
  payload:    z.record(z.string(), z.unknown()),
});

export const CreateMerchantSchema = z.object({
  name:  z.string().min(1),
  email: z.string().email(),
});

export const AgentListQuerySchema = z.object({
  merchantId: z.string().uuid(),
  status:     z.string().optional(),
});

export const DeadStockTriggerSchema = z.object({
  merchantId:          z.string().uuid(),
  lookbackDays:        z.number().int().min(7).max(180).default(45),
  minCapitalLockedInr: z.number().min(0).default(5000),
});
