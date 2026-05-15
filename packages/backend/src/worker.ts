// ── Worker process ─────────────────────────────────────────────────────────────
// Runs all BullMQ workers (sync + agent schedulers).
// Start with: npm run worker (tsx watch src/worker.ts)

import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './core/config';
import { registerDeadStockScheduler } from './agents/deadStockScheduler';
import { db } from './db/client';
import { merchants } from './db/schema';

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ── Existing sync-jobs worker ─────────────────────────────────────────────────
const syncWorker = new Worker(
  'sync-jobs',
  async (job) => {
    console.log('Processing job:', job.name, job.data);
    // Full sync logic added on Day 3
  },
  { connection }
);

syncWorker.on('completed', (job) => {
  console.log('Job', job.id, 'completed');
});

syncWorker.on('failed', (job, err) => {
  console.error('Job', job?.id, 'failed:', err.message);
});

console.log('Worker listening on queue: sync-jobs');

// ── Dead Stock Agent scheduler ────────────────────────────────────────────────
// Register a nightly dead-stock run for every active merchant.
async function registerAgentSchedulers() {
  try {
    const activeMerchants = await db
      .select({ id: merchants.id, name: merchants.name })
      .from(merchants);

    for (const merchant of activeMerchants) {
      registerDeadStockScheduler(connection, merchant.id);
      console.log(
        `[Worker] Dead stock scheduler registered for: ${merchant.name} (${merchant.id})`
      );
    }
  } catch (err) {
    console.error('[Worker] Failed to register agent schedulers:', err);
  }
}

registerAgentSchedulers();
