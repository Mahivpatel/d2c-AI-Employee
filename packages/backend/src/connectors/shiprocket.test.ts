import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeShiprocketShipment,
  ShiprocketConnector,
  ShiprocketShipment,
} from "./shiprocket";

function makeShipment(overrides: Partial<ShiprocketShipment> = {}): ShiprocketShipment {
  return {
    id: 123,
    shipment_id: 456,
    awb_code: "AWB123",
    courier_name: "Delhivery Surface",
    status: "Delivered",
    status_code: 7,
    created_at: "2026-05-01T10:00:00+05:30",
    delivered_date: "2026-05-04T10:00:00+05:30",
    freight_charge: 88.5,
    delivery_address: { city: "Mumbai", pincode: "400063" },
    channel_order_id: "SHOP-1001",
    payment_method: "COD",
    products: [{ name: "Everyday Cotton Tee", sku: "TEE-BLK-M" }],
    weight: 0.45,
    ...overrides,
  };
}

describe("normalizeShiprocketShipment", () => {
  it("maps a shipment to a normalized Shiprocket shipment fact", () => {
    const fact = normalizeShiprocketShipment(makeShipment());

    expect(fact.source).toBe("shiprocket");
    expect(fact.entityType).toBe("shipment");
    expect(fact.occurredAt).toBeInstanceOf(Date);
    expect(Number.isNaN(fact.occurredAt.getTime())).toBe(false);
    expect(fact.rawPayload).not.toBeNull();
    expect(fact.amountInr).toBe(88.5);
  });

  it("detects RTO and NDR statuses from text and status codes", () => {
    const rto = normalizeShiprocketShipment(makeShipment({
      status: "RTO Delivered",
      status_code: 9,
    }));
    const ndr = normalizeShiprocketShipment(makeShipment({
      status: "Customer Undelivered",
      status_code: 6,
    }));

    expect(rto.dimensions["is_rto"]).toBe(true);
    expect(rto.dimensions["is_ndr"]).toBe(false);
    expect(ndr.dimensions["is_ndr"]).toBe(true);
  });

  it("places COD, SKU, courier, pincode, and order join key in dimensions", () => {
    const fact = normalizeShiprocketShipment(makeShipment());

    expect(fact.dimensions["is_cod"]).toBe(true);
    expect(fact.dimensions["sku"]).toBe("TEE-BLK-M");
    expect(fact.dimensions["courier"]).toBe("Delhivery Surface");
    expect(fact.dimensions["pincode"]).toBe("400063");
    expect(fact.dimensions["order_id"]).toBe("SHOP-1001");
  });
});

describe("ShiprocketConnector mock mode", () => {
  it("skips auth and reads normalized shipment facts from mock JSON", async () => {
    const connector = new ShiprocketConnector({
      mode: "mock",
      mockDataPath: "mock_data/shiprocket",
    });

    await connector.authenticate();
    const facts = await connector.fetch("shipment", {
      dateFrom: new Date("2026-05-03T00:00:00.000Z"),
      status: "RTO Delivered",
      limit: 1,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].source).toBe("shiprocket");
    expect(facts[0].entityType).toBe("shipment");
    expect(facts[0].dimensions["is_rto"]).toBe(true);
  });

  it("throws a clear error for unsupported entities", async () => {
    const connector = new ShiprocketConnector({ mode: "mock" });
    await connector.authenticate();

    await expect(connector.fetch("invoice")).rejects.toThrow(/unsupported entity/);
  });
});

describe("ShiprocketConnector live mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates, sends bearer token, and normalizes live shipment data", async () => {
    const authResponse = new Response(JSON.stringify({ token: "shiprocket-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const shipmentResponse = new Response(JSON.stringify({ data: [makeShipment({ id: 999 })] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (String(_url).includes("/auth/login")) return authResponse;
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer shiprocket-token",
      });
      return shipmentResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    const connector = new ShiprocketConnector({
      mode: "live",
      email: "merchant@example.com",
      password: "secret",
    });

    await connector.authenticate();
    const facts = await connector.fetch("shipment");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(facts).toHaveLength(1);
    expect(facts[0].rawId).toBe("shipment:999");
  });
});
