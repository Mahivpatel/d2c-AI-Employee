import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: "../../.env" });

const EnvSchema = z.object({
  DATABASE_URL:            z.string().url(),
  REDIS_URL:               z.string().url(),
  ANTHROPIC_API_KEY:       z.string().min(1).optional().default(''),
  GROQ_API_KEY:            z.string().min(1),
  SHOPIFY_SHOP_DOMAIN:     z.string().default(""),
  SHOPIFY_ACCESS_TOKEN:    z.string().default(""),
  META_MODE:               z.enum(["mock", "live"]).default("mock"),
  META_MOCK_DATA_PATH:     z.string().default("mock_data/meta_ads"),
  META_GRAPH_API_VERSION:  z.string().default("v19.0"),
  META_ACCESS_TOKEN:       z.string().default(""),
  META_AD_ACCOUNT_ID:      z.string().default(""),
  SHIPROCKET_MODE:         z.enum(["mock", "live"]).default("mock"),
  SHIPROCKET_MOCK_DATA_PATH: z.string().default("mock_data/shiprocket"),
  SHIPROCKET_EMAIL:        z.string().default(""),
  SHIPROCKET_PASSWORD:     z.string().default(""),
  PORT:                    z.coerce.number().default(3000),
  CONNECTOR_VERSION:       z.string().default("1.0.0"),
  DEFAULT_FX_RATE_USD_INR: z.coerce.number().default(83.5),
  JWT_SECRET:              z.string().min(16),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:\n");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
