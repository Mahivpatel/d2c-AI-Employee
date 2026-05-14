// ── ShopifyConnector ──────────────────────────────────────────────────────────
// Uses native fetch (Node 18+, no axios). Auth is header-based access token.
// API version pinned to 2024-01 for stability.

import { config } from "../core/config";
import {
  BaseConnector,
  ConnectorSchema,
  FetchFilters,
  NormalizedFact,
} from "./base";

// ── Raw Shopify order shape (partial — only fields we consume) ────────────────

interface ShopifyMoneySet {
  shop_money: { amount: string; currency_code: string };
  presentment_money: { amount: string; currency_code: string };
}

interface ShopifyAddress {
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
}

interface ShopifyLineItem {
  id: number;
  sku: string | null;
  title: string;
  quantity: number;
  price: string;
}

export interface ShopifyOrder {
  id: number;
  name: string;                   // "#1001"
  created_at: string;             // ISO-8601
  financial_status: string;       // paid | pending | refunded ...
  fulfillment_status: string | null;
  current_total_price_set: ShopifyMoneySet;
  currency: string;
  customer?: {
    id: number;
    email?: string;
    tags?: string;
  };
  billing_address?: ShopifyAddress;
  shipping_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
  tags: string;
  source_name: string;            // web | ios | android | pos
}

// ── Normalizer (pure function — easy to unit-test) ────────────────────────────

/**
 * Maps a raw Shopify order → NormalizedFact.
 *
 * Currency conversion: if the order is in USD we use DEFAULT_FX_RATE_USD_INR.
 * All other non-INR currencies are stored as-is (fxRateUsed = 0 → flag for review).
 */
export function normalizeShopifyOrder(
  order: ShopifyOrder,
  fxRate: number = config.DEFAULT_FX_RATE_USD_INR,
): NormalizedFact {
  const shopMoney = order.current_total_price_set.shop_money;
  const originalCurrency = shopMoney.currency_code.toUpperCase();
  const originalAmount = parseFloat(shopMoney.amount);

  let amountInr: number;
  let fxRateUsed: number;

  if (originalCurrency === "INR") {
    amountInr = originalAmount;
    fxRateUsed = 1;
  } else if (originalCurrency === "USD") {
    amountInr = originalAmount * fxRate;
    fxRateUsed = fxRate;
  } else {
    // Unknown currency — store raw, flag with fxRateUsed = 0
    amountInr = originalAmount;
    fxRateUsed = 0;
  }

  const dimensions: Record<string, unknown> = {
    order_name:         order.name,
    financial_status:   order.financial_status,
    fulfillment_status: order.fulfillment_status ?? "unfulfilled",
    source_name:        order.source_name,
    tags:               order.tags,
    // Geo — from shipping address, fall back to billing
    city:    order.shipping_address?.city    ?? order.billing_address?.city,
    state:   order.shipping_address?.province ?? order.billing_address?.province,
    country: order.shipping_address?.country  ?? order.billing_address?.country,
    pincode: order.shipping_address?.zip      ?? order.billing_address?.zip,
    // SKU list (comma-separated) — useful for product-level filtering
    skus: order.line_items
      .map((li) => li.sku ?? li.title)
      .join(","),
    item_count: order.line_items.reduce((sum, li) => sum + li.quantity, 0),
    customer_id: order.customer?.id ?? null,
  };

  return {
    source:           "shopify",
    entityType:       "order",
    occurredAt:       new Date(order.created_at),
    amountInr,
    currencyOriginal: originalCurrency,
    fxRateUsed,
    rawId:            String(order.id),
    rawPayload:       order as unknown as Record<string, unknown>,
    dimensions,
  };
}

// ── ShopifyConnector class ────────────────────────────────────────────────────

export class ShopifyConnector implements BaseConnector {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private authenticated = false;

  constructor(
    shopDomain: string = config.SHOPIFY_SHOP_DOMAIN,
    accessToken: string = config.SHOPIFY_ACCESS_TOKEN,
  ) {
    this.baseUrl    = `https://${shopDomain}/admin/api/2024-01`;
    this.accessToken = accessToken;
  }

  // ── BaseConnector.authenticate() ─────────────────────────────────────────

  async authenticate(): Promise<void> {
    if (!this.accessToken) {
      throw new Error("ShopifyConnector: SHOPIFY_ACCESS_TOKEN is not set.");
    }
    if (!config.SHOPIFY_SHOP_DOMAIN) {
      throw new Error("ShopifyConnector: SHOPIFY_SHOP_DOMAIN is not set.");
    }
    // Lightweight ping — fetch shop metadata
    const res = await fetch(`${this.baseUrl}/shop.json`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(
        `ShopifyConnector: Auth failed — ${res.status} ${res.statusText}`,
      );
    }
    this.authenticated = true;
    console.log("[shopify] authenticated ✓");
  }

  // ── BaseConnector.schema() ────────────────────────────────────────────────

  schema(): ConnectorSchema {
    return {
      source:       "shopify",
      entityTypes:  ["order"],
      dimensionKeys: [
        "order_name",
        "financial_status",
        "fulfillment_status",
        "source_name",
        "tags",
        "city",
        "state",
        "country",
        "pincode",
        "skus",
        "item_count",
        "customer_id",
      ],
      description:
        "Shopify e-commerce orders. Each row is one order with INR amount, " +
        "geo, SKU list, and fulfillment state.",
    };
  }

  // ── BaseConnector.fetch() ─────────────────────────────────────────────────

  async fetch(
    entity: string,
    filters: FetchFilters = {},
  ): Promise<NormalizedFact[]> {
    this.assertAuthenticated();

    if (entity !== "order") {
      throw new Error(`ShopifyConnector: unsupported entity "${entity}". Use "order".`);
    }

    const params = new URLSearchParams();
    params.set("limit", String(filters.limit ?? 250));
    params.set("status", filters.status ?? "any");
    if (filters.dateFrom) params.set("created_at_min", filters.dateFrom.toISOString());
    if (filters.dateTo)   params.set("created_at_max", filters.dateTo.toISOString());
    if (filters.sinceId)  params.set("since_id", filters.sinceId);

    const url = `${this.baseUrl}/orders.json?${params.toString()}`;

    console.log(`[shopify] GET ${url}`);

    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) {
      throw new Error(
        `ShopifyConnector: fetch orders failed — ${res.status} ${res.statusText}`,
      );
    }

    const body = (await res.json()) as { orders: ShopifyOrder[] };
    const orders: ShopifyOrder[] = body.orders ?? [];

    console.log(`[shopify] fetched ${orders.length} orders`);

    return orders.map((o) => normalizeShopifyOrder(o));
  }

  // ── BaseConnector.write() ─────────────────────────────────────────────────
  // Dispatches mutations back to Shopify Admin REST API.
  // ONLY called after a human has approved an AgentRun proposal.
  //
  // Supported actions (passed as payload.action):
  //   cancel      – POST /orders/{id}/cancel.json        (reason, email, refund)
  //   add_tags    – PUT  /orders/{id}.json               (append tags)
  //   remove_tags – PUT  /orders/{id}.json               (strip tags)
  //   close       – POST /orders/{id}/close.json
  //   update_note – PUT  /orders/{id}.json               (set note field)

  async write(
    entity: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.assertAuthenticated();

    if (entity !== "order") {
      throw new Error(
        `ShopifyConnector.write(): unsupported entity "${entity}". Use "order".`,
      );
    }

    const orderId = payload["order_id"];
    if (!orderId) {
      throw new Error('ShopifyConnector.write(): payload must include "order_id".');
    }

    const action = payload["action"];
    if (!action || typeof action !== "string") {
      throw new Error(
        'ShopifyConnector.write(): payload must include "action" ' +
        '(cancel | add_tags | remove_tags | close | update_note).',
      );
    }

    switch (action) {
      case "cancel":
        return this.cancelOrder(String(orderId), payload);

      case "add_tags":
        return this.mutateTags(String(orderId), payload, "add");

      case "remove_tags":
        return this.mutateTags(String(orderId), payload, "remove");

      case "close":
        return this.closeOrder(String(orderId));

      case "update_note":
        return this.updateNote(String(orderId), payload);

      default:
        throw new Error(
          `ShopifyConnector.write(): unknown action "${action}". ` +
          "Supported: cancel, add_tags, remove_tags, close, update_note.",
        );
    }
  }

  // ── Private write helpers ─────────────────────────────────────────────────

  /** POST /orders/{id}/cancel.json */
  private async cancelOrder(
    orderId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    if (payload["reason"])    body["reason"]    = payload["reason"];
    if (payload["email"])     body["email"]     = payload["email"];
    if (payload["refund"])    body["refund"]    = payload["refund"];
    if (payload["note"])      body["note"]      = payload["note"];

    const res = await fetch(
      `${this.baseUrl}/orders/${orderId}/cancel.json`,
      {
        method:  "POST",
        headers: this.headers(),
        body:    JSON.stringify(body),
      },
    );
    return this.parseWriteResponse(res, "cancel", orderId);
  }

  /** PUT /orders/{id}.json — append or strip tags */
  private async mutateTags(
    orderId: string,
    payload: Record<string, unknown>,
    mode: "add" | "remove",
  ): Promise<Record<string, unknown>> {
    // Fetch current tags first
    const getRes = await fetch(
      `${this.baseUrl}/orders/${orderId}.json?fields=id,tags`,
      { headers: this.headers() },
    );
    if (!getRes.ok) {
      throw new Error(
        `ShopifyConnector: failed to read order ${orderId} — ${getRes.status} ${getRes.statusText}`,
      );
    }
    const current = (await getRes.json()) as { order: { id: number; tags: string } };
    const existingTags = current.order.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const incoming = (
      Array.isArray(payload["tags"]) ? payload["tags"] : [payload["tags"]]
    )
      .map((t) => String(t).trim())
      .filter(Boolean);

    let newTags: string[];
    if (mode === "add") {
      const set = new Set([...existingTags, ...incoming]);
      newTags = [...set];
    } else {
      const removeSet = new Set(incoming);
      newTags = existingTags.filter((t) => !removeSet.has(t));
    }

    const res = await fetch(`${this.baseUrl}/orders/${orderId}.json`, {
      method:  "PUT",
      headers: this.headers(),
      body:    JSON.stringify({ order: { id: Number(orderId), tags: newTags.join(", ") } }),
    });
    return this.parseWriteResponse(res, mode === "add" ? "add_tags" : "remove_tags", orderId);
  }

  /** POST /orders/{id}/close.json */
  private async closeOrder(orderId: string): Promise<Record<string, unknown>> {
    const res = await fetch(
      `${this.baseUrl}/orders/${orderId}/close.json`,
      { method: "POST", headers: this.headers() },
    );
    return this.parseWriteResponse(res, "close", orderId);
  }

  /** PUT /orders/{id}.json — set note field */
  private async updateNote(
    orderId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const note = payload["note"];
    if (typeof note !== "string") {
      throw new Error('ShopifyConnector.write(update_note): payload must include a string "note".');
    }
    const res = await fetch(`${this.baseUrl}/orders/${orderId}.json`, {
      method:  "PUT",
      headers: this.headers(),
      body:    JSON.stringify({ order: { id: Number(orderId), note } }),
    });
    return this.parseWriteResponse(res, "update_note", orderId);
  }

  /** Unified response handler for all write calls. */
  private async parseWriteResponse(
    res: Response,
    action: string,
    orderId: string,
  ): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `ShopifyConnector.write(${action}) failed for order ${orderId} — ` +
        `${res.status} ${res.statusText}: ${text}`,
      );
    }
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      console.log(`[shopify] write(${action}) order=${orderId} ok`);
      return json;
    } catch {
      return { raw: text };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "X-Shopify-Access-Token": this.accessToken,
      "Content-Type":           "application/json",
    };
  }

  private assertAuthenticated(): void {
    if (!this.authenticated) {
      throw new Error(
        "ShopifyConnector: call authenticate() before fetch().",
      );
    }
  }
}
