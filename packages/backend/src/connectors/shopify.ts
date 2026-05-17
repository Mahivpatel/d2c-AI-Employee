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

interface ShopifyProductVariant {
  id: number;
  price: string;
  sku: string | null;
  title?: string;
  inventory_item_id?: number;
  inventory_quantity?: number;
  updated_at?: string;
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

export interface ShopifyProduct {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  vendor: string;
  product_type: string;
  status: string;
  tags: string;
  variants: ShopifyProductVariant[];
}

interface ShopifyInventoryItem {
  id: number;
  cost?: string | null;
  sku?: string | null;
}

interface ShopifyInventoryLevel {
  inventory_item_id: number;
  available?: number | null;
}

export interface ShopifyCustomer {
  id: number;
  email: string | null;
  created_at: string;
  updated_at: string;
  first_name: string | null;
  last_name: string | null;
  orders_count: number;
  state: string;
  total_spent: string;
  tags: string;
  currency: string;
  default_address?: ShopifyAddress;
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

export function normalizeShopifyProduct(
  product: ShopifyProduct,
): NormalizedFact {
  const firstVariant = product.variants?.[0];
  const amountInr = firstVariant ? parseFloat(firstVariant.price) : 0;
  
  const dimensions: Record<string, unknown> = {
    title: product.title,
    vendor: product.vendor,
    product_type: product.product_type,
    status: product.status,
    tags: product.tags,
    skus: product.variants?.map(v => v.sku).filter(Boolean).join(",") || "",
  };

  return {
    source:           "shopify",
    entityType:       "product",
    occurredAt:       new Date(product.created_at),
    amountInr,
    currencyOriginal: "UNKNOWN",
    fxRateUsed:       1,
    rawId:            String(product.id),
    rawPayload:       product as unknown as Record<string, unknown>,
    dimensions,
  };
}

export function normalizeShopifyInventory(
  product: ShopifyProduct,
  variant: ShopifyProductVariant,
  inventoryItem?: ShopifyInventoryItem,
): NormalizedFact {
  const price = parseFloat(variant.price || "0");
  const quantityAvailable = Number(variant.inventory_quantity ?? 0);
  const shopifyCost = inventoryItem?.cost != null
    ? parseFloat(String(inventoryItem.cost))
    : NaN;
  const hasShopifyCost = Number.isFinite(shopifyCost) && shopifyCost > 0;
  const costPerItem = hasShopifyCost ? shopifyCost : Math.round(price * 0.45 * 100) / 100;
  const sku = variant.sku || inventoryItem?.sku || `${product.id}-${variant.id}`;

  const dimensions: Record<string, unknown> = {
    sku,
    product_title: product.title,
    variant_title: variant.title,
    product_id: product.id,
    variant_id: variant.id,
    inventory_item_id: variant.inventory_item_id ?? null,
    quantity_available: quantityAvailable,
    cost_per_item: costPerItem,
    cost_source: hasShopifyCost ? "shopify_inventory_item" : "estimated_from_price",
    price,
    vendor: product.vendor,
    product_type: product.product_type,
    status: product.status,
    tags: product.tags,
  };

  return {
    source:           "shopify",
    entityType:       "inventory",
    occurredAt:       new Date(variant.updated_at ?? product.updated_at ?? product.created_at),
    amountInr:        quantityAvailable * costPerItem,
    currencyOriginal: "INR",
    fxRateUsed:       1,
    rawId:            `inventory:${variant.id}`,
    rawPayload:       {
      product,
      variant,
      inventory_item: inventoryItem ?? null,
    } as unknown as Record<string, unknown>,
    dimensions,
  };
}

export function normalizeShopifyCustomer(
  customer: ShopifyCustomer,
  fxRate: number = config.DEFAULT_FX_RATE_USD_INR,
): NormalizedFact {
  const originalCurrency = (customer.currency || "INR").toUpperCase();
  const originalAmount = parseFloat(customer.total_spent || "0");

  let amountInr: number;
  let fxRateUsed: number;

  if (originalCurrency === "INR") {
    amountInr = originalAmount;
    fxRateUsed = 1;
  } else if (originalCurrency === "USD") {
    amountInr = originalAmount * fxRate;
    fxRateUsed = fxRate;
  } else {
    amountInr = originalAmount;
    fxRateUsed = 0;
  }

  const dimensions: Record<string, unknown> = {
    email: customer.email,
    first_name: customer.first_name,
    last_name: customer.last_name,
    orders_count: customer.orders_count,
    state: customer.state,
    tags: customer.tags,
    city: customer.default_address?.city,
    province: customer.default_address?.province,
    country: customer.default_address?.country,
    pincode: customer.default_address?.zip,
  };

  return {
    source:           "shopify",
    entityType:       "customer",
    occurredAt:       new Date(customer.created_at),
    amountInr,
    currencyOriginal: originalCurrency,
    fxRateUsed,
    rawId:            String(customer.id),
    rawPayload:       customer as unknown as Record<string, unknown>,
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
      entityTypes:  ["order", "product", "customer", "inventory"],
      dimensionKeys: [
        "order_name",
        "financial_status",
        "fulfillment_status",
        "source_name",
        "title",
        "vendor",
        "product_type",
        "status",
        "email",
        "first_name",
        "last_name",
        "orders_count",
        "tags",
        "city",
        "state",
        "country",
        "pincode",
        "skus",
        "item_count",
        "customer_id",
        "quantity_available",
        "cost_per_item",
        "cost_source",
        "price",
        "variant_id",
        "inventory_item_id",
      ],
      description:
        "Shopify e-commerce data (orders, products, customers, inventory). Each row is one entity with INR amount, " +
        "geo, tags, inventory quantity, cost, and relevant state.",
    };
  }

  // ── BaseConnector.fetch() ─────────────────────────────────────────────────

  async fetch(
    entity: string,
    filters: FetchFilters = {},
  ): Promise<NormalizedFact[]> {
    this.assertAuthenticated();

    if (!["order", "product", "customer", "inventory"].includes(entity)) {
      throw new Error(`ShopifyConnector: unsupported entity "${entity}". Use "order", "product", "customer", or "inventory".`);
    }

    const params = new URLSearchParams();
    params.set("limit", String(filters.limit ?? 250));
    
    if (entity === "order") {
      params.set("status", filters.status ?? "any");
    }

    if (filters.dateFrom) params.set("created_at_min", filters.dateFrom.toISOString());
    if (filters.dateTo)   params.set("created_at_max", filters.dateTo.toISOString());
    if (filters.sinceId)  params.set("since_id", filters.sinceId);

    const endpoint = entity === "inventory" ? "products" : `${entity}s`;
    const url = `${this.baseUrl}/${endpoint}.json?${params.toString()}`;

    console.log(`[shopify] GET ${url}`);

    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) {
      throw new Error(
        `ShopifyConnector: fetch ${entity}s failed — ${res.status} ${res.statusText}`,
      );
    }

    const body = (await res.json()) as any;

    if (entity === "order") {
      const items: ShopifyOrder[] = body.orders ?? [];
      console.log(`[shopify] fetched ${items.length} orders`);
      return items.map((o) => normalizeShopifyOrder(o));
    } else if (entity === "product") {
      const items: ShopifyProduct[] = body.products ?? [];
      console.log(`[shopify] fetched ${items.length} products`);
      return items.map((p) => normalizeShopifyProduct(p));
    } else if (entity === "inventory") {
      const items: ShopifyProduct[] = body.products ?? [];
      const inventoryItems = await this.fetchInventoryItems(items);
      const inventoryLevels = await this.fetchInventoryLevels(items);
      console.log(`[shopify] fetched ${items.length} products for inventory`);
      return items.flatMap((p) =>
        (p.variants ?? []).map((v) => {
          const available = v.inventory_item_id
            ? inventoryLevels.get(v.inventory_item_id)
            : undefined;

          return normalizeShopifyInventory(
            p,
            {
              ...v,
              inventory_quantity: available ?? v.inventory_quantity,
            },
            v.inventory_item_id ? inventoryItems.get(v.inventory_item_id) : undefined,
          );
        }),
      );
    } else {
      const items: ShopifyCustomer[] = body.customers ?? [];
      console.log(`[shopify] fetched ${items.length} customers`);
      return items.map((c) => normalizeShopifyCustomer(c));
    }
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

  private async fetchInventoryItems(
    products: ShopifyProduct[],
  ): Promise<Map<number, ShopifyInventoryItem>> {
    const ids = products
      .flatMap((p) => p.variants ?? [])
      .map((v) => v.inventory_item_id)
      .filter((id): id is number => typeof id === "number");

    const uniqueIds = [...new Set(ids)];
    const byId = new Map<number, ShopifyInventoryItem>();
    const CHUNK = 50;

    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const chunk = uniqueIds.slice(i, i + CHUNK);
      const url = `${this.baseUrl}/inventory_items.json?ids=${chunk.join(",")}`;

      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        console.warn(
          `[shopify] inventory_items fetch skipped - ${res.status} ${res.statusText}. ` +
          "Dead-stock costs will fall back to estimated cost from variant price.",
        );
        continue;
      }

      const body = (await res.json()) as { inventory_items?: ShopifyInventoryItem[] };
      for (const item of body.inventory_items ?? []) {
        byId.set(item.id, item);
      }
    }

    return byId;
  }

  private async fetchInventoryLevels(
    products: ShopifyProduct[],
  ): Promise<Map<number, number>> {
    const ids = products
      .flatMap((p) => p.variants ?? [])
      .map((v) => v.inventory_item_id)
      .filter((id): id is number => typeof id === "number");

    const uniqueIds = [...new Set(ids)];
    const byItemId = new Map<number, number>();
    const CHUNK = 50;

    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const chunk = uniqueIds.slice(i, i + CHUNK);
      const url = `${this.baseUrl}/inventory_levels.json?inventory_item_ids=${chunk.join(",")}`;

      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        console.warn(
          `[shopify] inventory_levels fetch skipped - ${res.status} ${res.statusText}. ` +
          "Dead-stock quantities will fall back to variant inventory_quantity.",
        );
        continue;
      }

      const body = (await res.json()) as { inventory_levels?: ShopifyInventoryLevel[] };
      for (const level of body.inventory_levels ?? []) {
        if (typeof level.available === "number") {
          byItemId.set(level.inventory_item_id, level.available);
        }
      }
    }

    return byItemId;
  }

  private assertAuthenticated(): void {
    if (!this.authenticated) {
      throw new Error(
        "ShopifyConnector: call authenticate() before fetch().",
      );
    }
  }
}
