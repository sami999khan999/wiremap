import { QueueName } from "@loadbearing/application";
import type { Container } from "@loadbearing/composition";
import { FixedClock, RecordingQueuePublisher } from "@loadbearing/composition";
import type { Job } from "bullmq";
import { describe, expect, it } from "vitest";
import { NotificationConsumer } from "../../src/consumer/notification.consumer.js";

const NOW = new Date("2026-09-26T07:00:00Z");

// Two nodes, their tenants in the catalog. Node 0 holds more than a page, so the paging
// is what gets them all rather than a coincidence of size.
const tenantsOn: Record<number, readonly string[]> = {
  0: Array.from({ length: 501 }, (_, index) => `org-0-${String(index).padStart(4, "0")}`),
  1: ["org-1-0000"],
};

const harness = () => {
  const queue = new RecordingQueuePublisher();
  const pages: { node: number | undefined; after: string | null }[] = [];
  const batches: number[] = [];
  const publishMany = queue.publishMany.bind(queue);
  queue.publishMany = (name, jobs) => {
    batches.push(jobs.length);
    return publishMany(name, jobs);
  };
  const emitted: unknown[] = [];

  const container = {
    clock: new FixedClock(NOW),
    queue,
    logger: { emit: (...args: unknown[]) => emitted.push(args), failure: () => {} },
    eachShard: async (work: (node: number) => Promise<void>) => {
      for (const node of [0, 1]) await work(node);
    },
    organizations: {
      page: (after: string | null, limit: number, node?: number) => {
        pages.push({ node, after });
        const all = tenantsOn[node ?? 0] ?? [];
        const start = after === null ? 0 : all.indexOf(after) + 1;
        return Promise.resolve(all.slice(start, start + limit));
      },
    },
  } as unknown as Container;

  return { queue, pages, batches, consumer: new NotificationConsumer(container, {} as never, 1) };
};

describe("NotificationConsumer fan-out", () => {
  // `CR.22`: the tenants come from the catalog a page at a time, per node, rather than from
  // a scan of every tenant's unread rows that ran out of locks.
  it("queues one digest per tenant on every node, a page at a time", async () => {
    const { queue, pages, batches, consumer } = harness();

    await consumer.handle({ name: "digest-fanout", data: {} } as Job);

    const jobs = queue.publishedTo(QueueName.NOTIFICATION);
    expect(jobs).toHaveLength(502);
    expect(jobs[0]?.options?.jobId).toBe("digest_org-0-0000_2026-09-26");
    expect(pages.map((page) => page.node)).toEqual([0, 0, 1]);
    expect(batches).toEqual([500, 1, 1]);
  });
});
