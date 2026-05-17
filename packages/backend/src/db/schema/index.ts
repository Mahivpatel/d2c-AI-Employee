import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  bigserial,
  real,
} from "drizzle-orm/pg-core";

// ── Merchants ─────────────────────────────────────────────────────────────────

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Universal Fact ────────────────────────────────────────────────────────────
//
// Every number in an LLM response must trace back to rows here.
// Schema is intentionally wide — connectors fill what they know.

export const facts = pgTable(
  "facts",
  {
    factId: uuid("fact_id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),

    // Provenance — who put this row here and when
    source: varchar("source", { length: 50 }).notNull(),            // shopify | meta_ads | shiprocket
    entityType: varchar("entity_type", { length: 50 }).notNull(),   // order | ad_spend | shipment
    connectorVersion: varchar("connector_version", { length: 20 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),

    // Time — normalized UTC
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    // Money — always INR, always float
    amountInr: real("amount_inr").notNull().default(0),
    currencyOriginal: varchar("currency_original", { length: 10 }).notNull().default("INR"),
    fxRateUsed: real("fx_rate_used").notNull().default(1),

    // Flexible context — product_id, sku, campaign_id, city, pincode, is_rto, etc.
    dimensions: jsonb("dimensions").notNull().default({}),

    // Original source record — immutable audit trail
    rawId: varchar("raw_id", { length: 255 }).notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
  },
  (table) => ({
    // Tenant + type queries
    merchantSourceTypeIdx: index("ix_facts_merchant_source_type").on(
      table.merchantId,
      table.source,
      table.entityType
    ),
    // Time-range scans
    occurredAtIdx: index("ix_facts_occurred_at").on(table.occurredAt),
    // Upsert uniqueness — prevent duplicate connector pulls
    merchantSourceRawIdIdx: uniqueIndex("ix_facts_merchant_source_raw_id").on(
      table.merchantId,
      table.source,
      table.rawId
    ),
    // JSONB dimension queries via GIN — e.g. WHERE dimensions->>'pincode' = '400063'
    dimensionsGinIdx: index("ix_facts_dimensions_gin")
      .on(table.dimensions)
      .using(sql`gin`),
  })
);

// ── Sync Logs ─────────────────────────────────────────────────────────────────
// Tracks every connector run — powers the "data last synced X min ago" UI badge

export const syncLogs = pgTable(
  "sync_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    connector: varchar("connector", { length: 50 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    rowsUpserted: numeric("rows_upserted").notNull().default("0"),
    errorMessage: text("error_message"),
    status: varchar("status", { length: 20 }).notNull().default("running"),
    // running | success | failed
  },
  (table) => ({
    merchantConnectorIdx: index("ix_sync_logs_merchant_connector").on(
      table.merchantId,
      table.connector
    ),
  })
);

// ── Agent Runs ────────────────────────────────────────────────────────────────
// Full audit trail for every autonomous agent execution.
// Proposals sit here as pending_review until a human approves or dismisses.

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    agentName: varchar("agent_name", { length: 100 }).notNull(), // rto_agent | budget_agent

    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),

    // Full reasoning chain stored as JSONB
    inputsSnapshot: jsonb("inputs_snapshot").notNull(),
    intermediateCalculations: jsonb("intermediate_calculations").notNull(),

    // What the agent wants to do
    proposals: jsonb("proposals").notNull(),
    confidenceScore: real("confidence_score").notNull().default(0),

    // Human sign-off state
    status: varchar("status", { length: 30 }).notNull().default("pending_review"),
    // pending_review | approved | dismissed | executed
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: varchar("reviewed_by", { length: 255 }),
  },
  (table) => ({
    merchantStatusIdx: index("ix_agent_runs_merchant_status").on(
      table.merchantId,
      table.status
    ),
    agentNameIdx: index("ix_agent_runs_agent_name").on(
      table.merchantId,
      table.agentName
    ),
  })
);

// ── Relations ─────────────────────────────────────────────────────────────────

export const merchantsRelations = relations(merchants, ({ many }) => ({
  facts: many(facts),
  syncLogs: many(syncLogs),
  agentRuns: many(agentRuns),
}));

export const factsRelations = relations(facts, ({ one }) => ({
  merchant: one(merchants, {
    fields: [facts.merchantId],
    references: [merchants.id],
  }),
}));

export const syncLogsRelations = relations(syncLogs, ({ one }) => ({
  merchant: one(merchants, {
    fields: [syncLogs.merchantId],
    references: [merchants.id],
  }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  merchant: one(merchants, {
    fields: [agentRuns.merchantId],
    references: [merchants.id],
  }),
}));

// ── Exported types ────────────────────────────────────────────────────────────

export type Merchant = typeof merchants.$inferSelect;
export type NewMerchant = typeof merchants.$inferInsert;
export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;
export type SyncLog = typeof syncLogs.$inferSelect;
export type NewSyncLog = typeof syncLogs.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
