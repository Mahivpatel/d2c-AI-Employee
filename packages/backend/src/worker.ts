import { Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "./core/config";

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  "sync-jobs",
  async (job) => {
    console.log("Processing job:", job.name, job.data);
    // Full sync logic added on Day 3
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log("Job", job.id, "completed");
});

worker.on("failed", (job, err) => {
  console.error("Job", job?.id, "failed:", err.message);
});

console.log("Worker listening on queue: sync-jobs");
