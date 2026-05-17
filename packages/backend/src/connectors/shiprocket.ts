import fs from "fs";
import path from "path";
import { config } from "../core/config";
import {
  BaseConnector,
  ConnectorSchema,
  FetchFilters,
  NormalizedFact,
} from "./base";

export type ShiprocketMode = "mock" | "live";

export interface ShiprocketConnectorOptions {
  mode?: ShiprocketMode;
  mockDataPath?: string;
  email?: string;
  password?: string;
  baseUrl?: string;
}

interface ShiprocketAddress {
  city?: string | null;
  pincode?: string | number | null;
  pin_code?: string | number | null;
  postcode?: string | number | null;
}

interface ShiprocketProduct {
  name?: string | null;
  sku?: string | null;
}

export interface ShiprocketShipment {
  id?: string | number;
  shipment_id?: string | number;
  awb_code?: string | null;
  awb?: string | null;
  courier_name?: string | null;
  courier?: string | null;
  status?: string | null;
  current_status?: string | null;
  status_code?: string | number | null;
  created_at?: string | null;
  updated_at?: string | null;
  shipped_date?: string | null;
  delivered_date?: string | null;
  freight_charge?: string | number | null;
  delivery_address?: ShiprocketAddress | null;
  customer_city?: string | null;
  customer_pincode?: string | number | null;
  channel_order_id?: string | number | null;
  order_id?: string | number | null;
  payment_method?: string | null;
  products?: ShiprocketProduct[];
  product_name?: string | null;
  sku?: string | null;
  weight?: string | number | null;
}

interface ShiprocketEvent {
  id?: string | number;
  event_id?: string | number;
  shipment_id?: string | number;
  awb_code?: string | null;
  awb?: string | null;
  courier_name?: string | null;
  courier?: string | null;
  status?: string | null;
  reason?: string | null;
  created_at?: string | null;
  event_time?: string | null;
  activity_date?: string | null;
  pincode?: string | number | null;
}

const ENTITY_FILE: Record<string, string> = {
  shipment: "shipments.json",
  shipments: "shipments.json",
  ndr_event: "ndr_events.json",
  ndr_events: "ndr_events.json",
  rto_event: "rto_events.json",
  rto_events: "rto_events.json",
  tracking_event: "tracking_history.json",
  tracking_events: "tracking_history.json",
};

const LIVE_ENDPOINT: Record<string, string> = {
  shipment: "/shipments",
  shipments: "/shipments",
  ndr_event: "/ndr/all",
  ndr_events: "/ndr/all",
};

const RTO_STATUS_CODES = new Set(["9", "10", "17", "18", "21"]);
const NDR_STATUS_CODES = new Set(["6", "8", "16"]);

function asDate(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

function statusText(raw: ShiprocketShipment | ShiprocketEvent): string {
  return String(raw.status ?? (raw as ShiprocketShipment).current_status ?? "").trim();
}

function isRtoStatus(status: string, code?: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("rto") ||
    normalized.includes("return to origin") ||
    (code ? RTO_STATUS_CODES.has(code) : false)
  );
}

function isNdrStatus(status: string, code?: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("ndr") ||
    normalized.includes("undelivered") ||
    normalized.includes("delivery failed") ||
    (code ? NDR_STATUS_CODES.has(code) : false)
  );
}

function getRawId(entityType: string, raw: ShiprocketShipment | ShiprocketEvent): string {
  const id =
    raw.id ??
    (raw as ShiprocketEvent).event_id ??
    raw.shipment_id ??
    raw.awb_code ??
    raw.awb;

  return `${entityType}:${String(id ?? `${Date.now()}-${Math.random()}`)}`;
}

export function normalizeShiprocketShipment(
  shipment: ShiprocketShipment,
): NormalizedFact {
  const status = statusText(shipment);
  const statusCode = asString(shipment.status_code);
  const firstProduct = shipment.products?.[0];
  const address = shipment.delivery_address ?? {};
  const paymentMethod = String(shipment.payment_method ?? "").toUpperCase();
  const amountInr = asNumber(shipment.freight_charge);

  const dimensions: Record<string, unknown> = {
    shipment_id: shipment.shipment_id ?? shipment.id ?? null,
    awb_code: shipment.awb_code ?? shipment.awb ?? null,
    courier: shipment.courier_name ?? shipment.courier ?? null,
    status,
    status_code: statusCode ?? null,
    is_rto: isRtoStatus(status, statusCode),
    is_ndr: isNdrStatus(status, statusCode),
    city: address.city ?? shipment.customer_city ?? null,
    pincode:
      address.pincode ??
      address.pin_code ??
      address.postcode ??
      shipment.customer_pincode ??
      null,
    order_id: shipment.channel_order_id ?? shipment.order_id ?? null,
    payment_method: paymentMethod || null,
    is_cod: paymentMethod === "COD",
    product_name: firstProduct?.name ?? shipment.product_name ?? null,
    sku: firstProduct?.sku ?? shipment.sku ?? null,
    weight: asNumber(shipment.weight, 0),
    delivery_date: shipment.delivered_date ?? null,
    freight_charge: amountInr,
  };

  return {
    source: "shiprocket",
    entityType: "shipment",
    occurredAt: asDate(shipment.created_at ?? shipment.updated_at ?? shipment.shipped_date),
    amountInr,
    currencyOriginal: "INR",
    fxRateUsed: 1,
    rawId: getRawId("shipment", shipment),
    rawPayload: shipment as unknown as Record<string, unknown>,
    dimensions,
  };
}

export function normalizeShiprocketEvent(
  event: ShiprocketEvent,
  entityType: "ndr_event" | "rto_event" | "tracking_event",
): NormalizedFact {
  const status = statusText(event);
  const dimensions: Record<string, unknown> = {
    shipment_id: event.shipment_id ?? null,
    awb_code: event.awb_code ?? event.awb ?? null,
    courier: event.courier_name ?? event.courier ?? null,
    status,
    reason: event.reason ?? null,
    pincode: event.pincode ?? null,
    is_rto: entityType === "rto_event" || isRtoStatus(status),
    is_ndr: entityType === "ndr_event" || isNdrStatus(status),
  };

  return {
    source: "shiprocket",
    entityType,
    occurredAt: asDate(event.created_at ?? event.event_time ?? event.activity_date),
    amountInr: 0,
    currencyOriginal: "INR",
    fxRateUsed: 1,
    rawId: getRawId(entityType, event),
    rawPayload: event as unknown as Record<string, unknown>,
    dimensions,
  };
}

export class ShiprocketConnector implements BaseConnector {
  private readonly mode: ShiprocketMode;
  private readonly mockDataPath: string;
  private readonly email: string;
  private readonly password: string;
  private readonly baseUrl: string;
  private token: string | null = null;
  private authenticated = false;

  constructor(options: ShiprocketConnectorOptions = {}) {
    this.mode = options.mode ?? config.SHIPROCKET_MODE;
    this.mockDataPath = options.mockDataPath ?? config.SHIPROCKET_MOCK_DATA_PATH;
    this.email = options.email ?? config.SHIPROCKET_EMAIL;
    this.password = options.password ?? config.SHIPROCKET_PASSWORD;
    this.baseUrl = options.baseUrl ?? "https://apiv2.shiprocket.in/v1/external";
  }

  async authenticate(): Promise<void> {
    if (this.mode === "mock") {
      this.authenticated = true;
      console.log("[shiprocket] mock mode - auth skipped");
      return;
    }

    if (!this.email || !this.password) {
      throw new Error("ShiprocketConnector: SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD are required in live mode.");
    }

    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });

    if (!res.ok) {
      throw new Error(`ShiprocketConnector: auth failed - ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { token?: string; data?: { token?: string } };
    this.token = body.token ?? body.data?.token ?? null;
    if (!this.token) {
      throw new Error("ShiprocketConnector: auth response did not include a token.");
    }

    this.authenticated = true;
    console.log("[shiprocket] authenticated");
  }

  schema(): ConnectorSchema {
    return {
      source: "shiprocket",
      entityTypes: ["shipment", "ndr_event", "rto_event", "tracking_event"],
      dimensionKeys: [
        "shipment_id",
        "awb_code",
        "courier",
        "status",
        "status_code",
        "is_rto",
        "is_ndr",
        "city",
        "pincode",
        "order_id",
        "payment_method",
        "is_cod",
        "product_name",
        "sku",
        "weight",
        "delivery_date",
        "freight_charge",
        "reason",
      ],
      description:
        "Shiprocket logistics data: shipments, courier status, COD, freight, RTO/NDR, tracking, pincode and SKU context.",
    };
  }

  async fetch(entity: string, filters: FetchFilters = {}): Promise<NormalizedFact[]> {
    this.assertAuthenticated();
    if (!ENTITY_FILE[entity]) {
      throw new Error(
        `ShiprocketConnector: unsupported entity "${entity}". Use shipment, ndr_event, rto_event, or tracking_event.`,
      );
    }

    const raw =
      this.mode === "mock"
        ? this.fetchFromFile(entity, filters)
        : await this.fetchFromAPI(entity, filters);

    const filtered = this.applyFilters(raw, filters);

    if (entity === "shipment" || entity === "shipments") {
      return (filtered as ShiprocketShipment[]).map(normalizeShiprocketShipment);
    }

    const entityType = entity.replace(/s$/, "") as "ndr_event" | "rto_event" | "tracking_event";
    return (filtered as ShiprocketEvent[]).map((event) => normalizeShiprocketEvent(event, entityType));
  }

  async write(): Promise<Record<string, unknown>> {
    throw new Error("ShiprocketConnector.write(): write operations are not supported yet.");
  }

  private fetchFromFile(entity: string, filters: FetchFilters): Array<ShiprocketShipment | ShiprocketEvent> {
    const filePath = this.resolveMockFile(ENTITY_FILE[entity]);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(raw) ? raw : raw.data;
    if (!Array.isArray(rows)) {
      throw new Error(`ShiprocketConnector: mock file ${filePath} must contain an array or { data: [] }.`);
    }
    return rows;
  }

  private async fetchFromAPI(entity: string, filters: FetchFilters): Promise<Array<ShiprocketShipment | ShiprocketEvent>> {
    const endpoint = LIVE_ENDPOINT[entity];
    if (!endpoint) {
      throw new Error(`ShiprocketConnector: live mode does not support entity "${entity}" yet.`);
    }

    const params = new URLSearchParams();
    if (filters.limit) params.set("per_page", String(filters.limit));
    if (filters.dateFrom) params.set("from", filters.dateFrom.toISOString().slice(0, 10));
    if (filters.dateTo) params.set("to", filters.dateTo.toISOString().slice(0, 10));
    if (filters.status) params.set("status", String(filters.status));

    const url = `${this.baseUrl}${endpoint}${params.size ? `?${params.toString()}` : ""}`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`ShiprocketConnector: fetch ${entity} failed - ${res.status} ${res.statusText}`);
    }

    const body = await res.json() as any;
    const rows = body.data?.data ?? body.data ?? body.shipments ?? body.ndr ?? body;
    return Array.isArray(rows) ? rows : [];
  }

  private applyFilters<T extends ShiprocketShipment | ShiprocketEvent>(
    rows: T[],
    filters: FetchFilters,
  ): T[] {
    let results = rows.slice();

    if (filters.dateFrom) {
      results = results.filter((row) => asDate(row.created_at ?? (row as ShiprocketEvent).event_time) >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      results = results.filter((row) => asDate(row.created_at ?? (row as ShiprocketEvent).event_time) <= filters.dateTo!);
    }
    if (filters.status) {
      const expected = String(filters.status).toLowerCase();
      results = results.filter((row) => statusText(row).toLowerCase() === expected);
    }
    if (filters.sinceId) {
      results = results.filter((row) => String(row.id ?? row.shipment_id ?? "") > filters.sinceId!);
    }
    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  private resolveMockFile(fileName: string): string {
    const candidates = [
      path.resolve(process.cwd(), this.mockDataPath, fileName),
      path.resolve(process.cwd(), "..", "..", this.mockDataPath, fileName),
      path.resolve(__dirname, "..", "..", "..", "..", this.mockDataPath, fileName),
    ];

    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
      throw new Error(
        `ShiprocketConnector: mock file not found for ${fileName}. Tried: ${candidates.join(", ")}`,
      );
    }
    return found;
  }

  private assertAuthenticated(): void {
    if (!this.authenticated) {
      throw new Error("ShiprocketConnector: call authenticate() before fetch().");
    }
  }
}
