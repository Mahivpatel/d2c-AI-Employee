import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../core/config";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
