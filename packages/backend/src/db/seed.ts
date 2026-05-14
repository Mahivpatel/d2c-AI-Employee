import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { merchants } from "./schema";

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool);

  const rows = await db
    .insert(merchants)
    .values([
      { name: "Zara India Demo", email: "zara-demo@d2c.ai"     },
      { name: "Fabindia Demo",   email: "fabindia-demo@d2c.ai" },
    ])
    .onConflictDoNothing()
    .returning();

  if (rows.length === 0) {
    console.log("Merchants already seeded — nothing to insert.");
  } else {
    for (const m of rows) {
      console.log("Created merchant:", m.name, " id=", m.id);
    }
  }

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
