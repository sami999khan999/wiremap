// After `EMBEDDING_PROVIDER` or `EMBEDDING_MODEL` changes. Queues one `reembed` job per
// organization on the embedding queue; the worker re-embeds that tenant's stale chunks.

import { Queue, QueueName, Redis, sql } from "./src/import.js";
import { Database } from "./src/pg/primitive/index.js";

const databaseUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");
const queueUrl = process.env.REDIS_QUEUE_URL;
if (!queueUrl) throw new Error("REDIS_QUEUE_URL is required.");

// The catalog, which names every organization whichever node holds its chunks: the job
// is placed on the tenant's node by the consumer, not here.
const catalog = new Database({ url: databaseUrl });
const connection = new Redis(queueUrl, { maxRetriesPerRequest: null });
const queue = new Queue(QueueName.EMBEDDING, { connection });

try {
  const rows = await catalog.client.execute<{ id: string }>(sql`select id from organizations`);

  // One job id per tenant, so running this twice before the worker drains it queues
  // each tenant once.
  for (const row of rows.rows) {
    await queue.add(
      "reembed",
      { organizationId: row.id },
      { jobId: `reembed_${row.id}`, removeOnComplete: true, removeOnFail: 100 },
    );
  }
  console.log(`queued a re-embed for ${rows.rows.length} organization(s)`);
} finally {
  await queue.close();
  connection.disconnect();
  await catalog.close();
}
