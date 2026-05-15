// ── /api/agents routes ─────────────────────────────────────────────────────────
// GET  /api/agents?merchantId=&status=       list agent runs
// POST /api/agents/:id/approve               approve a run
// POST /api/agents/:id/dismiss               dismiss a run
// POST /api/agents/dead-stock/trigger        manually trigger a dead stock run

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import { agentRuns } from '../../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { runDeadStockAgent } from '../../agents/deadStockAgent';

const router = Router();

// ── GET /api/agents ────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { merchantId, status = 'pending_review' } = z
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

// ── POST /api/agents/dead-stock/trigger ───────────────────────────────────────
// Manual trigger for testing. Runs the full dead stock agent synchronously
// and returns the result. Great for curl / Postman testing.

router.post('/dead-stock/trigger', async (req, res, next) => {
  try {
    const body = z
      .object({
        merchantId: z.string().uuid(),
        lookbackDays: z.number().int().min(7).max(180).default(45),
        minCapitalLockedInr: z.number().min(0).default(5000),
      })
      .parse(req.body);

    console.log('[agents/dead-stock/trigger] Starting manual run:', body);

    const result = await runDeadStockAgent({
      merchantId: body.merchantId,
      lookbackDays: body.lookbackDays,
      minCapitalLockedInr: body.minCapitalLockedInr,
    });

    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/agents/:id/approve ──────────────────────────────────────────────

router.post('/:id/approve', async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, req.params.id));

    if (!run) return res.status(404).json({ error: 'Agent run not found' });
    if (run.status !== 'pending_review')
      return res.status(400).json({ error: `Run is already ${run.status}` });

    await db
      .update(agentRuns)
      .set({ status: 'approved', reviewedAt: new Date() })
      .where(eq(agentRuns.id, req.params.id));

    res.json({ status: 'approved', runId: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/agents/:id/dismiss ──────────────────────────────────────────────

router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, req.params.id));

    if (!run) return res.status(404).json({ error: 'Agent run not found' });

    await db
      .update(agentRuns)
      .set({ status: 'dismissed', reviewedAt: new Date() })
      .where(eq(agentRuns.id, req.params.id));

    res.json({ status: 'dismissed', runId: req.params.id });
  } catch (err) {
    next(err);
  }
});

export default router;
