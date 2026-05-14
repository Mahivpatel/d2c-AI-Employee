import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { agentRuns } from "../../db/schema";
import { and, eq, desc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { merchantId, status = "pending_review" } = z
      .object({ merchantId: z.string().uuid(), status: z.string().optional() })
      .parse(req.query);

    const runs = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.merchantId, merchantId), eq(agentRuns.status, status)))
      .orderBy(desc(agentRuns.runAt));

    res.json(runs);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/approve", async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, req.params.id));

    if (!run) return res.status(404).json({ error: "Agent run not found" });
    if (run.status !== "pending_review")
      return res.status(400).json({ error: `Run is already ${run.status}` });

    await db
      .update(agentRuns)
      .set({ status: "approved", reviewedAt: new Date() })
      .where(eq(agentRuns.id, req.params.id));

    res.json({ status: "approved", runId: req.params.id });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/dismiss", async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, req.params.id));

    if (!run) return res.status(404).json({ error: "Agent run not found" });

    await db
      .update(agentRuns)
      .set({ status: "dismissed", reviewedAt: new Date() })
      .where(eq(agentRuns.id, req.params.id));

    res.json({ status: "dismissed", runId: req.params.id });
  } catch (err) {
    next(err);
  }
});

export default router;
