import { describe, expect, it } from "vitest";
import { verifyCitations } from "./verifyCitations";

describe("verifyCitations", () => {
  it("preserves valid Shopify and Shiprocket citations", () => {
    const text =
      "Revenue is 100 [src: shopify, fact_ids: f_shop], ROAS is 2.4 [src: meta_ads, fact_ids: f_meta], and RTO is 20% [src: shiprocket, fact_ids: f_ship].";

    const { verified } = verifyCitations(text, [
      { output: { total_fact_ids: ["f_shop"], source: "shopify" } },
      { output: { total_fact_ids: ["f_meta"], source: "meta_ads" } },
      { output: { total_fact_ids: ["f_ship"], source: "shiprocket" } },
    ]);

    expect(verified).toContain("[src: shopify, fact_ids: f_shop]");
    expect(verified).toContain("[src: meta_ads, fact_ids: f_meta]");
    expect(verified).toContain("[src: shiprocket, fact_ids: f_ship]");
  });

  it("removes hallucinated fact ids from supported citations", () => {
    const text = "RTO is 20% [src: shiprocket, fact_ids: fake, f_ship].";

    const { verified } = verifyCitations(text, [
      { output: { fact_ids: ["f_ship"], source: "shiprocket" } },
    ]);

    expect(verified).toContain("[src: shiprocket, fact_ids: f_ship]");
    expect(verified).not.toContain("fake");
  });
});
