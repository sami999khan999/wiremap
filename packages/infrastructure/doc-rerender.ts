// After `MarkdownRenderer.version` moves. Queues one `doc-rerender` job per organization
// on the maintenance queue; the worker renders that tenant's stale published pages again.

import { Queue, QueueName, Redis, sql } from "./src/import.js";
import { Database } from "./src/pg/primitive/index.js";

const databaseUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");
const queueUrl = process.env.REDIS_QUEUE_URL;
if (!queueUrl) throw new Error("REDIS_QUEUE_URL is required.");

// The catalog names every organization; the consumer places each job on its node.
const catalog = new Database({ url: databaseUrl });
const connection = new Redis(queueUrl, { maxRetriesPerRequest: null });
const queue = new Queue(QueueName.MAINTENANCE, { connection });

try {
  const rows = await catalog.client.execute<{ id: string }>(sql`select id from organizations`);

  // One job id per tenant, so a second run before the worker drains queues nothing new.
  for (const row of rows.rows) {
    await queue.add(
      "doc-rerender",
      { organizationId: row.id },
      { jobId: `doc-rerender_${row.id}`, removeOnComplete: true, removeOnFail: 100 },
    );
  }
  console.log(`queued a doc re-render for ${rows.rows.length} organization(s)`);
} finally {
  await queue.close();
  connection.disconnect();
  await catalog.close();
}
