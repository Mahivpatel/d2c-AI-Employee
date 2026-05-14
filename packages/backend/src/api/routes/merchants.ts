import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { merchants } from "../../db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const CreateMerchantSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

router.post("/", async (req, res, next) => {
  try {
    const body = CreateMerchantSchema.parse(req.body);
    const [merchant] = await db.insert(merchants).values(body).returning();
    res.status(201).json(merchant);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const all = await db.select().from(merchants).where(eq(merchants.isActive, true));
    res.json(all);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, req.params.id));
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });
    res.json(merchant);
  } catch (err) {
    next(err);
  }
});

export default router;
