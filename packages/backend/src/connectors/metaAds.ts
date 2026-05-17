import fs from "fs";
import path from "path";
import { config } from "../core/config";
import {
  BaseConnector,
  ConnectorSchema,
  FetchFilters,
  NormalizedFact,
} from "./base";

export type MetaAdsMode = "mock" | "live";

export interface MetaAdsConnectorOptions {
  mode?: MetaAdsMode;
  mockDataPath?: string;
  accessToken?: string;
  adAccountId?: string;
  baseUrl?: string;
}

interface MetaActionMetric {
  action_type: string;
  value: string;
}

export interface MetaAdInsightDaily {
  date_start: string;
  date_stop: string;
  campaign_id: string;
  campaign_name: string;
  ad_set_id?: string;
  adset_id?: string;
  ad_set_name?: string;
  adset_name?: string;
  ad_id: string;
  ad_name: string;
  account_currency?: string;
  spend: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  unique_clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  purchase_roas?: MetaActionMetric[];
  actions?: MetaActionMetric[];
  action_values?: MetaActionMetric[];
  cost_per_action_type?: MetaActionMetric[];
  account_id?: string;
}

interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  daily_budget?: string | null;
  lifetime_budget?: string | null;
  start_time?: string | null;
  stop_time?: string | null;
  account_id?: string;
  created_time?: string;
}

interface MetaAdSet {
  id: string;
  campaign_id: string;
  name: string;
  status?: string;
  daily_budget?: string | null;
  billing_event?: string;
  optimization_goal?: string;
  targeting?: Record<string, unknown>;
  created_time?: string;
}

interface MetaAd {
  id: string;
  ad_set_id?: string;
  adset_id?: string;
  campaign_id: string;
  name: string;
  status?: string;
  creative?: Record<string, unknown>;
  created_time?: string;
}

type MetaRawEntity = MetaAdInsightDaily | MetaCampaign | MetaAdSet | MetaAd;

const ENTITY_FILE: Record<string, string> = {
  campaign: "campaigns.json",
  campaigns: "campaigns.json",
  ad_set: "ad_sets.json",
  ad_sets: "ad_sets.json",
  ad: "ads.json",
  ads: "ads.json",
  ad_insights_daily: "ad_insights_daily.json",
  insight: "ad_insights_daily.json",
  insights: "ad_insights_daily.json",
};

const ENTITY_ALIASES: Record<string, string> = {
  campaign: "campaigns",
  campaigns: "campaigns",
  ad_set: "ad_sets",
  ad_sets: "ad_sets",
  ad: "ads",
  ads: "ads",
  ad_insights_daily: "ad_insights_daily",
  insight: "ad_insights_daily",
  insights: "ad_insights_daily",
};

function parseNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstActionValue(
  rows: MetaActionMetric[] | undefined,
  actionType: string,
): number | null {
  const row = rows?.find((item) => item.action_type === actionType);
  return row ? parseOptionalNumber(row.value) : null;
}

function asMetaDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function occurredAtFromDate(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

function budgetInr(value: string | null | undefined): number | null {
  const parsed = parseOptionalNumber(value);
  return parsed === null ? null : parsed / 100;
}

function normalizeInsight(row: MetaAdInsightDaily): NormalizedFact[] {
  const purchaseActionType = "offsite_conversion.fb_pixel_purchase";
  const adSetId = row.ad_set_id ?? row.adset_id ?? "";
  const adSetName = row.ad_set_name ?? row.adset_name ?? "";
  const spend = parseNumber(row.spend);
  const revenue = firstActionValue(row.action_values, purchaseActionType) ?? 0;
  const purchases = firstActionValue(row.actions, purchaseActionType) ?? 0;
  const addToCarts =
    firstActionValue(row.actions, "offsite_conversion.fb_pixel_add_to_cart") ?? 0;
  const costPerPurchase =
    firstActionValue(row.cost_per_action_type, purchaseActionType);
  const roas = row.purchase_roas?.[0]?.value
    ? parseNumber(row.purchase_roas[0].value)
    : revenue && spend
      ? Number((revenue / spend).toFixed(2))
      : null;

  const sharedDimensions: Record<string, unknown> = {
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    ad_set_id: adSetId,
    ad_set_name: adSetName,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    account_id: row.account_id ?? null,
    impressions: parseNumber(row.impressions),
    reach: parseNumber(row.reach),
    clicks: parseNumber(row.clicks),
    unique_clicks: parseNumber(row.unique_clicks),
    ctr: parseNumber(row.ctr),
    cpc: parseNumber(row.cpc),
    cpm: parseNumber(row.cpm),
    frequency: parseNumber(row.frequency),
    purchases,
    roas,
    cost_per_purchase: costPerPurchase,
    add_to_carts: addToCarts,
    account_currency: row.account_currency ?? "INR",
  };

  const occurredAt = occurredAtFromDate(row.date_start);
  const rawPayload = row as unknown as Record<string, unknown>;
  const facts: NormalizedFact[] = [
    {
      source: "meta_ads",
      entityType: "ad_spend",
      occurredAt,
      amountInr: spend,
      currencyOriginal: row.account_currency ?? "INR",
      fxRateUsed: 1,
      rawId: `${row.ad_id}_${row.date_start}_spend`,
      rawPayload,
      dimensions: { ...sharedDimensions },
    },
  ];

  if (revenue > 0) {
    facts.push({
      source: "meta_ads",
      entityType: "ad_attributed_revenue",
      occurredAt,
      amountInr: revenue,
      currencyOriginal: row.account_currency ?? "INR",
      fxRateUsed: 1,
      rawId: `${row.ad_id}_${row.date_start}_revenue`,
      rawPayload,
      dimensions: { ...sharedDimensions },
    });
  }

  return facts;
}

function normalizeCampaign(campaign: MetaCampaign): NormalizedFact {
  return {
    source: "meta_ads",
    entityType: "campaign",
    occurredAt: new Date(campaign.created_time ?? campaign.start_time ?? Date.now()),
    amountInr: 0,
    currencyOriginal: "INR",
    fxRateUsed: 1,
    rawId: `campaign:${campaign.id}`,
    rawPayload: campaign as unknown as Record<string, unknown>,
    dimensions: {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      status: campaign.status ?? null,
      objective: campaign.objective ?? null,
      daily_budget_minor: campaign.daily_budget ?? null,
      daily_budget_inr: budgetInr(campaign.daily_budget),
      lifetime_budget_minor: campaign.lifetime_budget ?? null,
      lifetime_budget_inr: budgetInr(campaign.lifetime_budget),
      account_id: campaign.account_id ?? null,
      start_time: campaign.start_time ?? null,
      stop_time: campaign.stop_time ?? null,
    },
  };
}

function normalizeAdSet(adSet: MetaAdSet): NormalizedFact {
  return {
    source: "meta_ads",
    entityType: "ad_set",
    occurredAt: new Date(adSet.created_time ?? Date.now()),
    amountInr: 0,
    currencyOriginal: "INR",
    fxRateUsed: 1,
    rawId: `ad_set:${adSet.id}`,
    rawPayload: adSet as unknown as Record<string, unknown>,
    dimensions: {
      ad_set_id: adSet.id,
      ad_set_name: adSet.name,
      campaign_id: adSet.campaign_id,
      status: adSet.status ?? null,
      daily_budget_minor: adSet.daily_budget ?? null,
      daily_budget_inr: budgetInr(adSet.daily_budget),
      billing_event: adSet.billing_event ?? null,
      optimization_goal: adSet.optimization_goal ?? null,
      targeting: adSet.targeting ?? null,
    },
  };
}

function normalizeAd(ad: MetaAd): NormalizedFact {
  const creative = ad.creative ?? {};
  return {
    source: "meta_ads",
    entityType: "ad",
    occurredAt: new Date(ad.created_time ?? Date.now()),
    amountInr: 0,
    currencyOriginal: "INR",
    fxRateUsed: 1,
    rawId: `ad:${ad.id}`,
    rawPayload: ad as unknown as Record<string, unknown>,
    dimensions: {
      ad_id: ad.id,
      ad_name: ad.name,
      ad_set_id: ad.ad_set_id ?? ad.adset_id ?? null,
      campaign_id: ad.campaign_id,
      status: ad.status ?? null,
      creative_id: creative["id"] ?? null,
      creative_format: creative["format"] ?? null,
      call_to_action: creative["call_to_action"] ?? null,
      destination_url: creative["destination_url"] ?? null,
    },
  };
}

export function normalizeMetaAdsInsight(row: MetaAdInsightDaily): NormalizedFact[] {
  return normalizeInsight(row);
}

export class MetaAdsConnector implements BaseConnector {
  private readonly mode: MetaAdsMode;
  private readonly mockDataPath: string;
  private readonly accessToken: string;
  private readonly adAccountId: string;
  private readonly baseUrl: string;
  private authenticated = false;

  constructor(options: MetaAdsConnectorOptions = {}) {
    this.mode = options.mode ?? config.META_MODE;
    this.mockDataPath = options.mockDataPath ?? config.META_MOCK_DATA_PATH;
    this.accessToken = options.accessToken ?? config.META_ACCESS_TOKEN;
    this.adAccountId = options.adAccountId ?? config.META_AD_ACCOUNT_ID;
    this.baseUrl = options.baseUrl ?? `https://graph.facebook.com/${config.META_GRAPH_API_VERSION}`;
  }

  async authenticate(): Promise<void> {
    if (this.mode === "mock") {
      this.authenticated = true;
      console.log("[meta_ads] mock mode - auth skipped");
      return;
    }

    if (!this.accessToken || !this.adAccountId) {
      throw new Error("MetaAdsConnector: META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required in live mode.");
    }

    const res = await fetch(`${this.baseUrl}/me?access_token=${encodeURIComponent(this.accessToken)}`);
    if (!res.ok) {
      throw new Error(`MetaAdsConnector: auth failed - ${res.status} ${res.statusText}`);
    }

    this.authenticated = true;
    console.log("[meta_ads] authenticated");
  }

  schema(): ConnectorSchema {
    return {
      source: "meta_ads",
      entityTypes: ["campaign", "ad_set", "ad", "ad_spend", "ad_attributed_revenue"],
      dimensionKeys: [
        "campaign_id",
        "campaign_name",
        "ad_set_id",
        "ad_set_name",
        "ad_id",
        "ad_name",
        "account_id",
        "status",
        "objective",
        "daily_budget_inr",
        "creative_format",
        "call_to_action",
        "destination_url",
        "impressions",
        "reach",
        "clicks",
        "unique_clicks",
        "ctr",
        "cpc",
        "cpm",
        "frequency",
        "purchases",
        "add_to_carts",
        "roas",
        "cost_per_purchase",
      ],
      description:
        "Meta Ads acquisition data: campaigns, ad sets, ads, daily spend, attributed revenue, ROAS, clicks, CTR, CPM, purchases, and creative context.",
    };
  }

  async fetch(entity: string, filters: FetchFilters = {}): Promise<NormalizedFact[]> {
    this.assertAuthenticated();
    const canonical = ENTITY_ALIASES[entity];
    if (!canonical) {
      throw new Error(
        `MetaAdsConnector: unsupported entity "${entity}". Use campaigns, ad_sets, ads, or ad_insights_daily.`,
      );
    }

    const raw =
      this.mode === "mock"
        ? this.fetchFromFile(canonical)
        : await this.fetchFromAPI(canonical, filters);

    const filtered = this.applyFilters(raw, filters);

    if (canonical === "ad_insights_daily") {
      return (filtered as MetaAdInsightDaily[]).flatMap(normalizeInsight);
    }

    if (canonical === "campaigns") {
      return (filtered as MetaCampaign[]).map(normalizeCampaign);
    }

    if (canonical === "ad_sets") {
      return (filtered as MetaAdSet[]).map(normalizeAdSet);
    }

    return (filtered as MetaAd[]).map(normalizeAd);
  }

  async write(): Promise<Record<string, unknown>> {
    throw new Error("MetaAdsConnector.write(): write operations are not supported yet.");
  }

  private fetchFromFile(entity: string): MetaRawEntity[] {
    const filePath = this.resolveMockFile(ENTITY_FILE[entity]);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(raw) ? raw : raw.data;
    if (!Array.isArray(rows)) {
      throw new Error(`MetaAdsConnector: mock file ${filePath} must contain an array or { data: [] }.`);
    }
    return rows as MetaRawEntity[];
  }

  private async fetchFromAPI(entity: string, filters: FetchFilters): Promise<MetaRawEntity[]> {
    const endpoints: Record<string, string> = {
      campaigns: `/${this.adAccountId}/campaigns`,
      ad_sets: `/${this.adAccountId}/adsets`,
      ads: `/${this.adAccountId}/ads`,
      ad_insights_daily: `/${this.adAccountId}/insights`,
    };

    const params = new URLSearchParams({
      access_token: this.accessToken,
      fields: this.fieldsFor(entity),
      limit: String(filters.limit ?? 500),
    });

    if (entity === "ad_insights_daily") {
      params.set("level", "ad");
      params.set("time_increment", "1");
      if (filters.dateFrom || filters.dateTo) {
        params.set("time_range", JSON.stringify({
          since: filters.dateFrom ? asMetaDate(filters.dateFrom) : undefined,
          until: filters.dateTo ? asMetaDate(filters.dateTo) : undefined,
        }));
      }
    }

    const res = await fetch(`${this.baseUrl}${endpoints[entity]}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`MetaAdsConnector: fetch ${entity} failed - ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { data?: MetaRawEntity[] };
    return body.data ?? [];
  }

  private applyFilters<T extends MetaRawEntity>(rows: T[], filters: FetchFilters): T[] {
    let results = rows.slice();

    if (filters.dateFrom) {
      const from = asMetaDate(filters.dateFrom);
      results = results.filter((row) => {
        const insight = row as MetaAdInsightDaily;
        return insight.date_start ? insight.date_start >= from : true;
      });
    }

    if (filters.dateTo) {
      const to = asMetaDate(filters.dateTo);
      results = results.filter((row) => {
        const insight = row as MetaAdInsightDaily;
        return insight.date_stop ? insight.date_stop <= to : true;
      });
    }

    if (filters.campaign_id) {
      results = results.filter((row) => (row as MetaAdInsightDaily).campaign_id === filters.campaign_id);
    }

    if (filters.ad_set_id) {
      results = results.filter((row) => {
        const insight = row as MetaAdInsightDaily;
        return (insight.ad_set_id ?? insight.adset_id) === filters.ad_set_id;
      });
    }

    if (filters.ad_id) {
      results = results.filter((row) => (row as MetaAdInsightDaily).ad_id === filters.ad_id);
    }

    if (filters.status) {
      const status = String(filters.status).toLowerCase();
      results = results.filter((row) => String((row as MetaCampaign).status ?? "").toLowerCase() === status);
    }

    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  private fieldsFor(entity: string): string {
    if (entity === "campaigns") {
      return "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,account_id,created_time";
    }
    if (entity === "ad_sets") {
      return "id,campaign_id,name,status,daily_budget,billing_event,optimization_goal,targeting,created_time";
    }
    if (entity === "ads") {
      return "id,adset_id,campaign_id,name,status,creative{id,object_type,call_to_action_type,link_url},created_time";
    }
    return [
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
      "spend",
      "impressions",
      "reach",
      "clicks",
      "unique_clicks",
      "ctr",
      "cpc",
      "cpm",
      "frequency",
      "purchase_roas",
      "actions",
      "action_values",
      "cost_per_action_type",
      "date_start",
      "date_stop",
      "account_currency",
      "account_id",
    ].join(",");
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
        `MetaAdsConnector: mock file not found for ${fileName}. Tried: ${candidates.join(", ")}`,
      );
    }
    return found;
  }

  private assertAuthenticated(): void {
    if (!this.authenticated) {
      throw new Error("MetaAdsConnector: call authenticate() before fetch().");
    }
  }
}
