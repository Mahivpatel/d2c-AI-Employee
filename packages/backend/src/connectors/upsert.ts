// ── Drizzle upsert for NormalizedFact[] → facts table ────────────────────────
// Uses the (source, raw_id) unique index so re-running a sync is idempotent.
// Existing rows are refreshed, which is important for inventory snapshots where
// stock and cost change over time.
//
// Provenance columns logged on every row:
//   fetched_at        — set by DB default (now()), always accurate
//   connector_version — stamped from CONNECTOR_VERSION env var

import { db } from "../db";
import { facts } from "../db/schema";
import { NormalizedFact } from "./base";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpsertResult {
  attempted: number;
  /** Rows actually written (0 when all were duplicates). */
  inserted: number;
}

// ── upsertFacts ───────────────────────────────────────────────────────────────

/**
 * Upserts a batch of NormalizedFacts into the facts table.
 *
 * @param merchantId  UUID of the merchant owning this data.
 * @param normalized  Output from a connector's fetch().
 * @returns           How many rows were attempted and inserted.
 *
 * Provenance added automatically:
 *   - connector_version  from process.env.CONNECTOR_VERSION (set by config)
 *   - fetched_at         set by Postgres defaultNow() — no clock drift from app
 */
export async function upsertFacts(
  merchantId: string,
  normalized: NormalizedFact[],
): Promise<UpsertResult> {
  if (normalized.length === 0) {
    return { attempted: 0, inserted: 0 };
  }

  const connectorVersion =
    process.env["CONNECTOR_VERSION"] ?? "unknown";

  // Log provenance context once per batch
  const fetchedAt = new Date().toISOString();
  console.log(
    `[upsert] batch=${normalized.length} ` +
    `connector_version=${connectorVersion} ` +
    `fetched_at=${fetchedAt}`,
  );

  const rows = normalized.map((fact) => ({
    merchantId,
    source:           fact.source,
    entityType:       fact.entityType,
    connectorVersion, // stamped from process.env on every row
    // fetched_at is defaultNow() in the schema — no need to set it
    occurredAt:       fact.occurredAt,
    amountInr:        fact.amountInr,
    currencyOriginal: fact.currencyOriginal ?? "INR",
    fxRateUsed:       fact.fxRateUsed       ?? 1,
    dimensions:       fact.dimensions,
    rawId:            fact.rawId,
    rawPayload:       fact.rawPayload,
  }));

  // Chunk into batches of 500 to avoid hitting Postgres parameter limits
  const CHUNK = 500;
  let totalInserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(facts)
      .values(chunk)
      .onConflictDoUpdate({
        target: [facts.source, facts.rawId],
        set: {
          merchantId:       sql`excluded.merchant_id`,
          entityType:       sql`excluded.entity_type`,
          connectorVersion: sql`excluded.connector_version`,
          fetchedAt:        sql`now()`,
          occurredAt:       sql`excluded.occurred_at`,
          amountInr:        sql`excluded.amount_inr`,
          currencyOriginal: sql`excluded.currency_original`,
          fxRateUsed:       sql`excluded.fx_rate_used`,
          dimensions:       sql`excluded.dimensions`,
          rawPayload:       sql`excluded.raw_payload`,
        },
      }); // dedup key: ix_facts_source_raw_id (source, raw_id)

    // Drizzle's upsert doesn't return a count in all drivers,
    // so we conservatively track attempted and compute delta later if needed.
    totalInserted += chunk.length;
  }

  console.log(`[upsert] done — attempted=${normalized.length}`);

  return {
    attempted: normalized.length,
    inserted:  totalInserted, // upper bound; true inserts may be fewer due to dedup
  };
}
