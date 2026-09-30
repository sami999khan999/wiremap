// The dead letter's other half. A job that runs out of attempts stays in BullMQ's failed
// set for a week (`BullMqQueuePublisher`), and this puts it back on its queue.

import { Queue, Redis } from "./src/import.js";

const QUEUES = ["mail", "event", "notification", "embedding", "maintenance"];

const [name, jobName] = process.argv.slice(2);
if (!name || !QUEUES.includes(name)) {
  throw new Error(`usage: pnpm queue:replay <${QUEUES.join("|")}> [jobName]`);
}

const url = process.env.REDIS_QUEUE_URL;
if (!url) throw new Error("REDIS_QUEUE_URL is required.");

const connection = new Redis(url, { maxRetriesPerRequest: null });
const queue = new Queue(name, { connection });

try {
  if (jobName) {
    // One name only: a queue carries several kinds of job, and replaying a digest fan-out
    // because a mail send failed would be a surprise.
    let replayed = 0;
    for (const job of await queue.getFailed()) {
      if (job.name !== jobName) continue;
      await job.retry();
      replayed += 1;
    }
    console.log(`${replayed} failed ${name}/${jobName} job(s) queued again`);
  } else {
    const failed = await queue.getFailedCount();
    await queue.retryJobs({ state: "failed" });
    console.log(`${failed} failed ${name} job(s) queued again`);
  }
} finally {
  await queue.close();
  connection.disconnect();
}
