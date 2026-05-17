const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "../mock_data/meta_ads");
fs.mkdirSync(OUT, { recursive: true });

let seed = 42;
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

const rand = (min, max) => +(random() * (max - min) + min).toFixed(2);
const floor = (n) => Math.floor(n);

function dateRange(startStr, days) {
  const dates = [];
  const d = new Date(`${startStr}T00:00:00.000Z`);
  for (let i = 0; i < days; i++) {
    dates.push(new Date(d).toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

const AD_COMBOS = [
  {
    campaign_id: "23851234567890",
    campaign_name: "KURTA-SS25-Acquisition",
    ad_set_id: "23851111100001",
    ad_set_name: "Women-25-44-Mumbai-Delhi",
    ad_id: "23852222200001",
    ad_name: "KURTA-L-RED-Carousel-v3",
    base_spend: 4800,
    base_ctr: 2.9,
    base_roas: 3.2,
  },
  {
    campaign_id: "23851234567890",
    campaign_name: "KURTA-SS25-Acquisition",
    ad_set_id: "23851111100002",
    ad_set_name: "Women-18-24-Tier2-Cities",
    ad_id: "23852222200002",
    ad_name: "KURTA-L-RED-Video-v1",
    base_spend: 3100,
    base_ctr: 2.1,
    base_roas: 1.85,
  },
  {
    campaign_id: "23851234567891",
    campaign_name: "LINEN-SETS-Retargeting",
    ad_set_id: "23851111100003",
    ad_set_name: "Site-Visitors-7day",
    ad_id: "23852222200003",
    ad_name: "LINEN-SET-DPA-v2",
    base_spend: 2200,
    base_ctr: 3.4,
    base_roas: 4.1,
  },
];

const days = dateRange("2025-04-01", 39);
const insights = [];

for (const date of days) {
  for (const combo of AD_COMBOS) {
    const spend = rand(combo.base_spend * 0.8, combo.base_spend * 1.2);
    const impressions = floor(spend * rand(7.5, 9.5));
    const ctr = rand(combo.base_ctr * 0.85, combo.base_ctr * 1.15);
    const clicks = Math.max(1, floor(impressions * (ctr / 100)));
    const cpm = +(spend / impressions * 1000).toFixed(2);
    const cpc = +(spend / clicks).toFixed(2);
    const purchases = floor(clicks * rand(0.025, 0.04));

    const isBadWeek = date >= "2025-05-05" && date <= "2025-05-09";
    const roas = rand(combo.base_roas * 0.8, combo.base_roas * 1.2);
    const roasFinal = isBadWeek ? +(roas * 0.55).toFixed(2) : roas;
    const revenue = +(spend * roasFinal).toFixed(2);

    insights.push({
      date_start: date,
      date_stop: date,
      campaign_id: combo.campaign_id,
      campaign_name: combo.campaign_name,
      ad_set_id: combo.ad_set_id,
      ad_set_name: combo.ad_set_name,
      ad_id: combo.ad_id,
      ad_name: combo.ad_name,
      account_currency: "INR",
      spend: String(spend),
      impressions: String(impressions),
      reach: String(floor(impressions * 0.92)),
      clicks: String(clicks),
      unique_clicks: String(floor(clicks * 0.96)),
      ctr: String(ctr),
      cpc: String(cpc),
      cpm: String(cpm),
      frequency: String(rand(1.05, 1.25)),
      purchase_roas: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: String(roasFinal) },
      ],
      actions: [
        { action_type: "link_click", value: String(clicks) },
        {
          action_type: "offsite_conversion.fb_pixel_add_to_cart",
          value: String(floor(clicks * 0.07)),
        },
        {
          action_type: "offsite_conversion.fb_pixel_purchase",
          value: String(purchases),
        },
      ],
      action_values: [
        {
          action_type: "offsite_conversion.fb_pixel_purchase",
          value: String(revenue),
        },
      ],
      cost_per_action_type: [
        {
          action_type: "offsite_conversion.fb_pixel_purchase",
          value: String((spend / (purchases || 1)).toFixed(2)),
        },
      ],
      account_id: "act_987654321",
    });
  }
}

fs.writeFileSync(
  path.join(OUT, "ad_insights_daily.json"),
  JSON.stringify(insights, null, 2),
);

console.log(`Generated ${insights.length} daily insight rows`);
