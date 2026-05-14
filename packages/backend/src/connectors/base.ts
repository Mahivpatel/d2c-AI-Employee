// ── Normalized output of every connector's fetch() ───────────────────────────
// Maps 1:1 to the facts table. The rest of the system only ever sees this —
// never raw Shopify orders or raw Meta campaigns.

export interface NormalizedFact {
  source: string;                         // "shopify" | "meta_ads" | "shiprocket"
  entityType: string;                     // "order" | "ad_spend" | "shipment"
  occurredAt: Date;                       // normalized UTC
  amountInr: number;                      // always ₹, always float
  rawId: string;                          // original ID in the source system
  rawPayload: Record<string, unknown>;    // original JSON, verbatim
  dimensions: Record<string, unknown>;    // flexible key-value context
  currencyOriginal?: string;
  fxRateUsed?: number;
}

// ── What fields a connector exposes ──────────────────────────────────────────

export interface ConnectorSchema {
  source: string;
  entityTypes: string[];
  dimensionKeys: string[];
  description: string;
}

// ── Fetch filters ─────────────────────────────────────────────────────────────

export interface FetchFilters {
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  sinceId?: string;
  status?: string;
  [key: string]: unknown;
}

// ── The contract every connector must fulfill ─────────────────────────────────
// TypeScript enforces this: any class that claims to implement BaseConnector
// MUST provide all four methods or the compiler will reject it.

export interface BaseConnector {
  /**
   * Set up auth credentials (OAuth, API key, refresh token).
   * Called once before any fetch() or write().
   */
  authenticate(): Promise<void>;

  /**
   * Pull a batch of records and return them as NormalizedFacts.
   * Never returns raw API data — always normalized.
   */
  fetch(entity: string, filters?: FetchFilters): Promise<NormalizedFact[]>;

  /**
   * Describe what this connector exposes.
   * Used by the chat layer to know what questions it can answer.
   */
  schema(): ConnectorSchema;

  /**
   * Execute an action back into the source system.
   * ONLY called after explicit human approval of an AgentRun proposal.
   * Connectors that are read-only should throw an explicit error here.
   */
  write(entity: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}
