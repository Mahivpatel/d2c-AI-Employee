import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MetaAdInsightDaily,
  MetaAdsConnector,
  normalizeMetaAdsInsight,
} from "./metaAds";

function makeInsight(overrides: Partial<MetaAdInsightDaily> = {}): MetaAdInsightDaily {
  return {
    date_start: "2025-05-05",
    date_stop: "2025-05-05",
    campaign_id: "23851234567890",
    campaign_name: "KURTA-SS25-Acquisition",
    ad_set_id: "23851111100001",
    ad_set_name: "Women-25-44-Mumbai-Delhi",
    ad_id: "23852222200001",
    ad_name: "KURTA-L-RED-Carousel-v3",
    account_currency: "INR",
    spend: "4821.50",
    impressions: "42310",
    reach: "38900",
    clicks: "1240",
    unique_clicks: "1190",
    ctr: "2.93",
    cpc: "3.89",
    cpm: "113.96",
    frequency: "1.09",
    purchase_roas: [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "3.21" },
    ],
    actions: [
      { action_type: "link_click", value: "1240" },
      { action_type: "offsite_conversion.fb_pixel_add_to_cart", value: "84" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "37" },
    ],
    action_values: [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "15476.85" },
    ],
    cost_per_action_type: [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "130.31" },
    ],
    account_id: "act_987654321",
    ...overrides,
  };
}

describe("normalizeMetaAdsInsight", () => {
  it("maps one insight row to spend and revenue facts", () => {
    const facts = normalizeMetaAdsInsight(makeInsight());

    expect(facts).toHaveLength(2);
    expect(facts[0].source).toBe("meta_ads");
    expect(facts[0].entityType).toBe("ad_spend");
    expect(facts[0].amountInr).toBeCloseTo(4821.5);
    expect(facts[1].entityType).toBe("ad_attributed_revenue");
    expect(facts[1].amountInr).toBeCloseTo(15476.85);
  });

  it("keeps campaign, ad set, ad, and performance metrics in dimensions", () => {
    const [spend] = normalizeMetaAdsInsight(makeInsight());

    expect(spend.dimensions["campaign_name"]).toBe("KURTA-SS25-Acquisition");
    expect(spend.dimensions["ad_set_name"]).toBe("Women-25-44-Mumbai-Delhi");
    expect(spend.dimensions["ad_name"]).toBe("KURTA-L-RED-Carousel-v3");
    expect(spend.dimensions["clicks"]).toBe(1240);
    expect(spend.dimensions["purchases"]).toBe(37);
    expect(spend.dimensions["roas"]).toBe(3.21);
  });
});

describe("MetaAdsConnector mock mode", () => {
  it("skips auth and reads normalized daily insight facts from mock JSON", async () => {
    const connector = new MetaAdsConnector({
      mode: "mock",
      mockDataPath: "mock_data/meta_ads",
    });

    await connector.authenticate();
    const facts = await connector.fetch("ad_insights_daily", {
      dateFrom: new Date("2025-05-05T00:00:00.000Z"),
      dateTo: new Date("2025-05-09T00:00:00.000Z"),
      campaign_id: "23851234567890",
    });

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => fact.source === "meta_ads")).toBe(true);
    expect(facts.some((fact) => fact.entityType === "ad_spend")).toBe(true);
    expect(facts.some((fact) => fact.entityType === "ad_attributed_revenue")).toBe(true);
  });

  it("normalizes campaign metadata from mock JSON", async () => {
    const connector = new MetaAdsConnector({
      mode: "mock",
      mockDataPath: "mock_data/meta_ads",
    });

    await connector.authenticate();
    const facts = await connector.fetch("campaigns", { status: "ACTIVE" });

    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0].entityType).toBe("campaign");
    expect(facts[0].amountInr).toBe(0);
  });

  it("throws a clear error for unsupported entities", async () => {
    const connector = new MetaAdsConnector({ mode: "mock" });
    await connector.authenticate();

    await expect(connector.fetch("pixel")).rejects.toThrow(/unsupported entity/);
  });
});

describe("MetaAdsConnector live mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates and normalizes live ad-level insights", async () => {
    const authResponse = new Response(JSON.stringify({ id: "me" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const insightResponse = new Response(JSON.stringify({ data: [makeInsight()] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/me?")) return authResponse;
      expect(url).toContain("/act_987654321/insights");
      expect(url).toContain("time_increment=1");
      return insightResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    const connector = new MetaAdsConnector({
      mode: "live",
      accessToken: "meta-token",
      adAccountId: "act_987654321",
    });

    await connector.authenticate();
    const facts = await connector.fetch("ad_insights_daily");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(facts).toHaveLength(2);
    expect(facts[0].rawId).toBe("23852222200001_2025-05-05_spend");
  });
});
