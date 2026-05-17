// ── Shopify connector smoke tests ─────────────────────────────────────────────
// Uses Vitest + native fetch mock (vi.stubGlobal).
// Does NOT touch the database — upsertFacts is exercised separately.
//
// Run: npm test --workspace=packages/backend
//   or: npx vitest run src/connectors/shopify.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeShopifyOrder,
  normalizeShopifyProduct,
  normalizeShopifyInventory,
  normalizeShopifyCustomer,
  ShopifyOrder,
  ShopifyProduct,
  ShopifyCustomer,
  ShopifyConnector,
} from "./shopify";
import { NormalizedFact } from "./base";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal valid Shopify order JSON (as returned by /orders.json). */
function makeOrder(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  return {
    id: 4_500_000_001,
    name: "#1001",
    created_at: "2024-03-15T10:30:00+05:30",
    financial_status: "paid",
    fulfillment_status: null,
    currency: "INR",
    current_total_price_set: {
      shop_money: { amount: "2499.00", currency_code: "INR" },
      presentment_money: { amount: "2499.00", currency_code: "INR" },
    },
    customer: { id: 9_900_000_001, email: "test@example.com", tags: "" },
    billing_address: { city: "Mumbai", province: "Maharashtra", country: "IN", zip: "400063" },
    shipping_address: { city: "Pune", province: "Maharashtra", country: "IN", zip: "411001" },
    line_items: [
      { id: 1, sku: "SKU-001", title: "Widget A", quantity: 2, price: "999.50" },
      { id: 2, sku: "SKU-002", title: "Widget B", quantity: 1, price: "500.00" },
    ],
    tags: "vip,repeat",
    source_name: "web",
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 1_000_000_001,
    title: "Widget A",
    created_at: "2024-03-15T10:30:00+05:30",
    updated_at: "2024-03-15T10:30:00+05:30",
    vendor: "Acme Corp",
    product_type: "Widget",
    status: "active",
    tags: "new,featured",
    variants: [{
      id: 1,
      price: "999.50",
      sku: "SKU-001",
      title: "Default Title",
      inventory_item_id: 5001,
      inventory_quantity: 12,
      updated_at: "2024-03-16T10:30:00+05:30",
    }],
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<ShopifyCustomer> = {}): ShopifyCustomer {
  return {
    id: 9_900_000_001,
    email: "test@example.com",
    created_at: "2024-03-15T10:30:00+05:30",
    updated_at: "2024-03-15T10:30:00+05:30",
    first_name: "John",
    last_name: "Doe",
    orders_count: 5,
    state: "enabled",
    total_spent: "5000.00",
    tags: "vip",
    currency: "INR",
    default_address: { city: "Mumbai", province: "Maharashtra", country: "IN", zip: "400063" },
    ...overrides,
  };
}

// ── normalizeShopifyOrder tests ───────────────────────────────────────────────

describe("normalizeShopifyOrder", () => {
  it("returns source='shopify' and entity_type='order'", () => {
    const fact = normalizeShopifyOrder(makeOrder());
    expect(fact.source).toBe("shopify");
    expect(fact.entityType).toBe("order");
  });

  it("sets rawId to string of order.id", () => {
    const fact = normalizeShopifyOrder(makeOrder({ id: 123_456 }));
    expect(fact.rawId).toBe("123456");
  });

  it("raw_payload is non-null and contains the original order id", () => {
    const order = makeOrder();
    const fact = normalizeShopifyOrder(order);
    expect(fact.rawPayload).not.toBeNull();
    expect((fact.rawPayload as unknown as ShopifyOrder).id).toBe(order.id);
  });

  it("occurred_at is a valid ISO timestamp (occurredAt is a Date)", () => {
    const fact = normalizeShopifyOrder(makeOrder());
    expect(fact.occurredAt).toBeInstanceOf(Date);
    expect(isNaN(fact.occurredAt.getTime())).toBe(false);
    // Round-trips back to ISO string without error
    const iso = fact.occurredAt.toISOString();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("parses INR amount correctly (fxRateUsed = 1)", () => {
    const fact = normalizeShopifyOrder(makeOrder());
    expect(fact.amountInr).toBeCloseTo(2499);
    expect(fact.fxRateUsed).toBe(1);
    expect(fact.currencyOriginal).toBe("INR");
  });

  it("converts USD to INR using the provided fxRate", () => {
    const order = makeOrder({
      currency: "USD",
      current_total_price_set: {
        shop_money: { amount: "100.00", currency_code: "USD" },
        presentment_money: { amount: "100.00", currency_code: "USD" },
      },
    });
    const fact = normalizeShopifyOrder(order, 84);
    expect(fact.amountInr).toBeCloseTo(8400);
    expect(fact.fxRateUsed).toBe(84);
  });

  it("flags unknown currencies with fxRateUsed = 0", () => {
    const order = makeOrder({
      currency: "EUR",
      current_total_price_set: {
        shop_money: { amount: "50.00", currency_code: "EUR" },
        presentment_money: { amount: "50.00", currency_code: "EUR" },
      },
    });
    const fact = normalizeShopifyOrder(order);
    expect(fact.fxRateUsed).toBe(0);
  });

  it("dimensions contain shipping city and pincode", () => {
    const fact = normalizeShopifyOrder(makeOrder());
    expect(fact.dimensions["city"]).toBe("Pune");      // shipping_address wins
    expect(fact.dimensions["pincode"]).toBe("411001");
  });

  it("dimensions contain concatenated SKUs", () => {
    const fact = normalizeShopifyOrder(makeOrder());
    expect(fact.dimensions["skus"]).toBe("SKU-001,SKU-002");
    expect(fact.dimensions["item_count"]).toBe(3); // 2 + 1
  });

  it("fulfillment_status defaults to 'unfulfilled' when null", () => {
    const fact = normalizeShopifyOrder(makeOrder({ fulfillment_status: null }));
    expect(fact.dimensions["fulfillment_status"]).toBe("unfulfilled");
  });
});

// ── normalizeShopifyProduct tests ─────────────────────────────────────────────

describe("normalizeShopifyProduct", () => {
  it("returns source='shopify' and entity_type='product'", () => {
    const fact = normalizeShopifyProduct(makeProduct());
    expect(fact.source).toBe("shopify");
    expect(fact.entityType).toBe("product");
    expect(fact.amountInr).toBeCloseTo(999.50);
    expect(fact.dimensions["title"]).toBe("Widget A");
    expect(fact.dimensions["skus"]).toBe("SKU-001");
  });
});

describe("normalizeShopifyInventory", () => {
  it("returns inventory facts per variant with Shopify cost when available", () => {
    const product = makeProduct();
    const fact = normalizeShopifyInventory(product, product.variants[0], {
      id: 5001,
      cost: "420.00",
      sku: "SKU-001",
    });

    expect(fact.source).toBe("shopify");
    expect(fact.entityType).toBe("inventory");
    expect(fact.rawId).toBe("inventory:1");
    expect(fact.amountInr).toBeCloseTo(5040);
    expect(fact.dimensions["sku"]).toBe("SKU-001");
    expect(fact.dimensions["quantity_available"]).toBe(12);
    expect(fact.dimensions["cost_per_item"]).toBe(420);
    expect(fact.dimensions["cost_source"]).toBe("shopify_inventory_item");
  });

  it("falls back to estimated cost from variant price when Shopify cost is missing", () => {
    const product = makeProduct();
    const fact = normalizeShopifyInventory(product, product.variants[0]);

    expect(fact.entityType).toBe("inventory");
    expect(fact.dimensions["cost_source"]).toBe("estimated_from_price");
    expect(Number(fact.dimensions["cost_per_item"])).toBeGreaterThan(0);
  });
});

// ── normalizeShopifyCustomer tests ────────────────────────────────────────────

describe("normalizeShopifyCustomer", () => {
  it("returns source='shopify' and entity_type='customer'", () => {
    const fact = normalizeShopifyCustomer(makeCustomer());
    expect(fact.source).toBe("shopify");
    expect(fact.entityType).toBe("customer");
    expect(fact.amountInr).toBeCloseTo(5000);
    expect(fact.dimensions["email"]).toBe("test@example.com");
    expect(fact.dimensions["city"]).toBe("Mumbai");
  });
});

// ── Full batch normalization ──────────────────────────────────────────────────

describe("batch normalization (array of orders)", () => {
  it("every output row has non-null raw_payload and valid occurred_at", () => {
    const orders: ShopifyOrder[] = [
      makeOrder({ id: 1, name: "#1001", created_at: "2024-01-10T09:00:00Z" }),
      makeOrder({ id: 2, name: "#1002", created_at: "2024-01-11T10:00:00Z" }),
      makeOrder({ id: 3, name: "#1003", created_at: "2024-01-12T11:00:00Z" }),
    ];

    const facts: NormalizedFact[] = orders.map((o) => normalizeShopifyOrder(o));

    facts.forEach((fact, idx) => {
      // Non-null raw_payload
      expect(fact.rawPayload, `row ${idx}: rawPayload`).not.toBeNull();
      expect(Object.keys(fact.rawPayload).length, `row ${idx}: rawPayload not empty`).toBeGreaterThan(0);

      // Valid ISO timestamp
      expect(fact.occurredAt, `row ${idx}: occurredAt`).toBeInstanceOf(Date);
      const iso = fact.occurredAt.toISOString();
      expect(iso, `row ${idx}: valid ISO`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});

// ── ShopifyConnector.fetch() with mocked global fetch ────────────────────────

describe("ShopifyConnector.fetch() with mocked API", () => {
  const mockOrders: ShopifyOrder[] = [
    makeOrder({ id: 101, name: "#2001" }),
    makeOrder({ id: 102, name: "#2002", financial_status: "pending" }),
  ];

  beforeEach(() => {
    // Stub authenticate call (shop.json ping)
    const shopResponse = new Response(JSON.stringify({ shop: { id: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    // Stub orders call
    const ordersResponse = new Response(
      JSON.stringify({ orders: mockOrders }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string) => {
      callCount++;
      return callCount === 1 ? shopResponse : ordersResponse;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a NormalizedFact for every mocked order", async () => {
    const connector = new ShopifyConnector(
      "test-store.myshopify.com",
      "shpat_test_token",
    );
    await connector.authenticate();
    const result = await connector.fetch("order");

    expect(result).toHaveLength(mockOrders.length);
    result.forEach((fact) => {
      expect(fact.source).toBe("shopify");
      expect(fact.entityType).toBe("order");
      expect(fact.rawPayload).not.toBeNull();
      expect(fact.occurredAt).toBeInstanceOf(Date);
    });
  });

  it("fetches and normalizes products", async () => {
    const mockProducts = [makeProduct({ id: 1 }), makeProduct({ id: 2 })];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("shop.json")) return new Response(JSON.stringify({ shop: { id: 1 } }));
      return new Response(JSON.stringify({ products: mockProducts }));
    }));

    const connector = new ShopifyConnector("test-store.myshopify.com", "shpat_test_token");
    await connector.authenticate();
    const result = await connector.fetch("product");
    expect(result).toHaveLength(2);
    expect(result[0].entityType).toBe("product");
  });

  it("fetches and normalizes customers", async () => {
    const mockCustomers = [makeCustomer({ id: 1 }), makeCustomer({ id: 2 })];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("shop.json")) return new Response(JSON.stringify({ shop: { id: 1 } }));
      return new Response(JSON.stringify({ customers: mockCustomers }));
    }));

    const connector = new ShopifyConnector("test-store.myshopify.com", "shpat_test_token");
    await connector.authenticate();
    const result = await connector.fetch("customer");
    expect(result).toHaveLength(2);
    expect(result[0].entityType).toBe("customer");
  });

  it("fetches and normalizes inventory from products and inventory_items", async () => {
    const mockProducts = [makeProduct({ id: 1 })];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("shop.json")) return new Response(JSON.stringify({ shop: { id: 1 } }));
      if (url.includes("inventory_items.json")) {
        return new Response(JSON.stringify({
          inventory_items: [{ id: 5001, cost: "420.00", sku: "SKU-001" }],
        }));
      }
      if (url.includes("inventory_levels.json")) {
        return new Response(JSON.stringify({
          inventory_levels: [{ inventory_item_id: 5001, available: 18 }],
        }));
      }
      return new Response(JSON.stringify({ products: mockProducts }));
    }));

    const connector = new ShopifyConnector("test-store.myshopify.com", "shpat_test_token");
    await connector.authenticate();
    const result = await connector.fetch("inventory");

    expect(result).toHaveLength(1);
    expect(result[0].entityType).toBe("inventory");
    expect(result[0].dimensions["quantity_available"]).toBe(18);
    expect(result[0].dimensions["cost_source"]).toBe("shopify_inventory_item");
  });

  it("throws on unsupported entity type", async () => {
    const connector = new ShopifyConnector(
      "test-store.myshopify.com",
      "shpat_test_token",
    );
    await connector.authenticate();
    await expect(connector.fetch("shipment")).rejects.toThrow(
      /unsupported entity/,
    );
  });
});

// ── ShopifyConnector.write() tests ────────────────────────────────────────────

describe("ShopifyConnector.write() with mocked API", () => {
  /** Authenticate the connector once per test using a mocked shop.json response. */
  async function makeAuthenticatedConnector() {
    const connector = new ShopifyConnector(
      "test-store.myshopify.com",
      "shpat_test_token",
    );
    // First call will be the auth ping
    return connector;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Helper: stub fetch so auth succeeds then subsequent calls return `responses` in order. */
  function stubFetch(...responses: Response[]) {
    const authOk = new Response(JSON.stringify({ shop: { id: 1 } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    const queue = [authOk, ...responses];
    let idx = 0;
    vi.stubGlobal("fetch", vi.fn(async () => queue[idx++] ?? queue[queue.length - 1]));
  }

  it("cancel: POSTs to /cancel.json and returns parsed JSON", async () => {
    const cancelResult = { order: { id: 1001, financial_status: "voided" } };
    stubFetch(
      new Response(JSON.stringify(cancelResult), { status: 200 }),
    );
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    const result = await connector.write("order", {
      order_id: "1001",
      action:   "cancel",
      reason:   "customer",
    });
    expect(result).toEqual(cancelResult);
  });

  it("close: POSTs to /close.json and returns response", async () => {
    const closeResult = { order: { id: 1001, status: "closed" } };
    stubFetch(
      new Response(JSON.stringify(closeResult), { status: 200 }),
    );
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    const result = await connector.write("order", {
      order_id: "1001",
      action:   "close",
    });
    expect(result).toEqual(closeResult);
  });

  it("update_note: PUTs note field and returns response", async () => {
    const noteResult = { order: { id: 1001, note: "Priority customer" } };
    stubFetch(
      new Response(JSON.stringify(noteResult), { status: 200 }),
    );
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    const result = await connector.write("order", {
      order_id: "1001",
      action:   "update_note",
      note:     "Priority customer",
    });
    expect(result).toEqual(noteResult);
  });

  it("add_tags: fetches existing tags, deduplicates, PUTs merged result", async () => {
    const getTagsResult = { order: { id: 1001, tags: "vip, repeat" } };
    const putResult     = { order: { id: 1001, tags: "vip, repeat, priority" } };
    stubFetch(
      // GET current tags
      new Response(JSON.stringify(getTagsResult), { status: 200 }),
      // PUT merged tags
      new Response(JSON.stringify(putResult), { status: 200 }),
    );
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    const result = await connector.write("order", {
      order_id: "1001",
      action:   "add_tags",
      tags:     ["vip", "priority"], // "vip" already exists — deduped
    });
    // Result is whatever Shopify echoed back
    expect((result as typeof putResult).order.tags).toBe("vip, repeat, priority");
  });

  it("remove_tags: strips specified tags and PUTs remainder", async () => {
    const getTagsResult = { order: { id: 1001, tags: "vip, repeat, priority" } };
    const putResult     = { order: { id: 1001, tags: "vip, priority" } };
    stubFetch(
      new Response(JSON.stringify(getTagsResult), { status: 200 }),
      new Response(JSON.stringify(putResult),     { status: 200 }),
    );
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    const result = await connector.write("order", {
      order_id: "1001",
      action:   "remove_tags",
      tags:     ["repeat"],
    });
    expect((result as typeof putResult).order.tags).toBe("vip, priority");
  });

  it("throws on unknown action", async () => {
    stubFetch(); // auth only
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    await expect(
      connector.write("order", { order_id: "1001", action: "refund" }),
    ).rejects.toThrow(/unknown action/);
  });

  it("throws when order_id is missing", async () => {
    stubFetch();
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    await expect(
      connector.write("order", { action: "cancel" }),
    ).rejects.toThrow(/order_id/);
  });

  it("throws on non-order entity", async () => {
    stubFetch();
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    await expect(
      connector.write("product", { order_id: "1", action: "cancel" }),
    ).rejects.toThrow(/unsupported entity/);
  });

  it("throws when Shopify returns a non-2xx status", async () => {
    stubFetch(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );
    const connector = await makeAuthenticatedConnector();
    await connector.authenticate();
    await expect(
      connector.write("order", { order_id: "999999", action: "cancel" }),
    ).rejects.toThrow(/404/);
  });
});
