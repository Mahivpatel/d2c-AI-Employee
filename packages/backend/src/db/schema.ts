import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── merchants ─────────────────────────────────────────────────────────────────

export const merchants = pgTable("merchants", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  email:     text("email").notNull().unique(),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── facts ─────────────────────────────────────────────────────────────────────
// The universal normalized record from every connector.
// Every LLM claim must trace back to rows here.

export const facts = pgTable(
  "facts",
  {
    factId:           uuid("fact_id").primaryKey().defaultRandom(),
    merchantId:       uuid("merchant_id").notNull().references(() => merchants.id),

    // Provenance
    source:           text("source").notNull(),           // shopify | meta_ads | shiprocket
    entityType:       text("entity_type").notNull(),      // order | ad_spend | shipment
    connectorVersion: text("connector_version").notNull(),
    fetchedAt:        timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),

    // Time
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    // Money — always INR
    amountInr:         doublePrecision("amount_inr").notNull().default(0),
    currencyOriginal:  text("currency_original").notNull().default("INR"),
    fxRateUsed:        doublePrecision("fx_rate_used").notNull().default(1),

    // Flexible context — city, sku, campaign_id, pincode, etc.
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),

    // Original source record
    rawId:      text("raw_id").notNull(),
    rawPayload: jsonb("raw_payload").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => ({
    // Fast tenant + source queries
    merchantSourceTypeIdx: index("ix_facts_merchant_source_type")
      .on(table.merchantId, table.source, table.entityType),
    // Time-range scans
    occurredAtIdx: index("ix_facts_occurred_at")
      .on(table.occurredAt),
    // Upsert deduplication
    merchantSourceRawIdIdx: uniqueIndex("ix_facts_merchant_source_raw_id")
      .on(table.merchantId, table.source, table.rawId),
    // JSONB dimension queries — WHERE dimensions->>'pincode' = '400063'
    dimensionsGinIdx: index("ix_facts_dimensions_gin")
      .on(table.dimensions)
      .using(sql`gin`),
  })
);

// ── sync_logs ─────────────────────────────────────────────────────────────────

export const syncLogs = pgTable(
  "sync_logs",
  {
    id:           serial("id").primaryKey(),
    merchantId:   uuid("merchant_id").notNull().references(() => merchants.id),
    connector:    text("connector").notNull(),
    startedAt:    timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt:  timestamp("completed_at", { withTimezone: true }),
    rowsUpserted: integer("rows_upserted").default(0),
    errorMessage: text("error_message"),
    status:       text("status").notNull().default("running"),
    // running | success | failed
  },
  (table) => ({
    merchantConnectorIdx: index("ix_sync_logs_merchant_connector")
      .on(table.merchantId, table.connector),
  })
);

// ── agent_runs ────────────────────────────────────────────────────────────────

export const agentRuns = pgTable(
  "agent_runs",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull().references(() => merchants.id),
    agentName:  text("agent_name").notNull(),   // rto_agent | budget_agent
    runAt:      timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),

    // Full reasoning chain stored as JSONB for auditability
    inputsSnapshot:          jsonb("inputs_snapshot").notNull(),
    intermediateCalculations: jsonb("intermediate_calculations").notNull(),

    // What the agent wants to do
    proposals:       jsonb("proposals").notNull(),
    confidenceScore: doublePrecision("confidence_score").notNull().default(0),

    // Human sign-off state
    status:     text("status").notNull().default("pending_review"),
    // pending_review | approved | dismissed | executed
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
  },
  (table) => ({
    merchantStatusIdx: index("ix_agent_runs_merchant_status")
      .on(table.merchantId, table.status),
    agentNameIdx: index("ix_agent_runs_agent_name")
      .on(table.merchantId, table.agentName),
  })
);

// ── relations ─────────────────────────────────────────────────────────────────

export const merchantRelations = relations(merchants, ({ many }) => ({
  facts:      many(facts),
  syncLogs:   many(syncLogs),
  agentRuns:  many(agentRuns),
}));

export const factsRelations = relations(facts, ({ one }) => ({
  merchant: one(merchants, {
    fields:     [facts.merchantId],
    references: [merchants.id],
  }),
}));

// ── TypeScript types exported for use throughout the app ──────────────────────

export type Merchant  = typeof merchants.$inferSelect;
export type NewMerchant = typeof merchants.$inferInsert;
export type Fact      = typeof facts.$inferSelect;
export type NewFact   = typeof facts.$inferInsert;
export type SyncLog   = typeof syncLogs.$inferSelect;
export type AgentRun  = typeof agentRuns.$inferSelect;
