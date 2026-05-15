// ── Dead Stock Agent — BullMQ scheduler ───────────────────────────────────────
// Registers the dead-stock-agent queue and a nightly cron job.
// Import this module from worker.ts to activate the scheduler.

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { runDeadStockAgent } from './deadStockAgent';
import type { DeadStockAgentInput } from './deadStockTypes';

export function registerDeadStockScheduler(
  connection: IORedis,
  merchantId: string
) {
  const deadStockQueue = new Queue<DeadStockAgentInput>('dead-stock-agent', {
    connection,
  });

  // ── Worker ────────────────────────────────────────────────────────────────────
  const worker = new Worker<DeadStockAgentInput>(
    'dead-stock-agent',
    async (job) => {
      console.log('[DeadStockScheduler] Processing job:', job.name, job.data);
      const result = await runDeadStockAgent(job.data);
      console.log('[DeadStockScheduler] Job done:', result);
      return result;
    },
    {
      connection,
      // Groq free tier: ~30 req/min — keep well under with a 25-job/min limit
      limiter: { max: 25, duration: 60_000 },
    }
  );

  worker.on('completed', (job) => {
    console.log('[DeadStockScheduler] Job', job.id, 'completed');
  });

  worker.on('failed', (job, err) => {
    console.error('[DeadStockScheduler] Job', job?.id, 'failed:', err.message);
  });

  // ── Nightly cron (04:00 IST = 22:30 UTC) ─────────────────────────────────────
  deadStockQueue
    .add(
      'dead-stock-nightly',
      {
        merchantId,
        lookbackDays: 45,
        minCapitalLockedInr: 5000,
      },
      {
        repeat: { pattern: '30 22 * * *' }, // 04:00 IST
        jobId: `dead-stock-${merchantId}`,
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 5 },
      }
    )
    .then(() => {
      console.log(
        `[DeadStockScheduler] Nightly job registered for merchant ${merchantId}`
      );
    })
    .catch((err: Error) => {
      console.error('[DeadStockScheduler] Failed to register cron:', err.message);
    });

  return { queue: deadStockQueue, worker };
}
