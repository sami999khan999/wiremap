import { RealtimeChannels } from "@loadbearing/application";
import { Queue, Worker } from "bullmq";
import { afterAll, describe, expect, inject, it } from "vitest";
import { BullMqQueuePublisher } from "../../src/bullmq/index.js";
import type { RealtimeMessage } from "../../src/import.js";
import {
  RedisCacheStore,
  RedisConnection,
  RedisRateLimitStore,
  RedisRealtimePublisher,
  RedisRealtimeSubscriber,
} from "../../src/redis/index.js";
import type {} from "./support/stack.js";

const stack = inject("stack");
const redis = new RedisConnection(stack.redis);

afterAll(async () => {
  await redis.close();
});

describe("RedisCacheStore against the running instance", () => {
  it("round-trips a value and prunes it by prefix", async () => {
    const cache = new RedisCacheStore(redis.client());

    await cache.set("smoke:probe", { ok: true }, 30);
    expect(await cache.get("smoke:probe")).toEqual({ ok: true });

    // Asserted after the prune, not before: `SCAN` returns fully-prefixed keys, and
    // passing them straight to `unlink` prefixes them again and deletes nothing.
    await cache.deletePrefix("smoke:");
    expect(await cache.get("smoke:probe")).toBeNull();
  });

  it("answers healthy for both instances, separately", async () => {
    expect(await redis.healthy("cache")).toBe(true);
    expect(await redis.healthy("queue")).toBe(true);
  });
});

// `CR.6`. The window starts at the first call and carries its own expiry, so a key that
// was counted is never left behind without one.
describe("RedisRateLimitStore against the running cache instance", () => {
  it("counts within a window, and starts again once it has passed", async () => {
    const limits = new RedisRateLimitStore(redis.client());
    const key = `smoke:rate:${Date.now()}`;

    expect(await limits.hit(key, 1)).toBe(1);
    expect(await limits.hit(key, 1)).toBe(2);
    expect(await redis.client().ttl(key)).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await limits.hit(key, 1)).toBe(1);
  });
});

describe("realtime against the running cache instance", () => {
  const ORG = "00000000-0000-7000-8000-000000000001";
  const USER = "00000000-0000-7000-8000-000000000002";
  const CHANNEL = RealtimeChannels.user(ORG, USER);

  // The one thing no fake can answer: that the publisher's channel string and the
  // subscriber's are the same string after ioredis has finished with both.
  it("delivers a published frame to a subscriber on the other client", async () => {
    const publisher = new RedisRealtimePublisher(redis.client());
    const subscriber = new RedisRealtimeSubscriber(() => redis.subscriberClient(), {
      maxStreamsPerUser: 8,
      maxAgeMs: 5_000,
      queueSize: 256,
    });
    const controller = new AbortController();
    const received: RealtimeMessage[] = [];

    const reading = (async () => {
      for await (const message of subscriber.subscribe([CHANNEL], controller.signal)) {
        received.push(message);
        break;
      }
      controller.abort();
    })();

    // The SUBSCRIBE has to be on the wire before the PUBLISH: pub/sub has no replay, so
    // a frame published first is not late, it is gone.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await publisher.publish(CHANNEL, {
      kind: "event",
      id: "00000000-0000-7000-8000-00000000000a",
      name: "member.changed",
      at: new Date("2026-01-01T00:00:00Z"),
      payload: {},
    });
    await reading;

    expect(received.map((message) => message.id)).toEqual(["00000000-0000-7000-8000-00000000000a"]);
  });

  // `26.5`. The frames a tab missed while it was away are in the log, in order, and a
  // resume from the first of them is handed the rest before anything live.
  it("replays a resumed stream from the log the publisher wrote", async () => {
    const channel = RealtimeChannels.user(ORG, "00000000-0000-7000-8000-0000000000e1");
    const publisher = new RedisRealtimePublisher(redis.client());
    const subscriber = new RedisRealtimeSubscriber(
      () => redis.subscriberClient(),
      { maxStreamsPerUser: 8, maxAgeMs: 5_000, queueSize: 256 },
      () => redis.client(),
    );
    const ids = [
      "00000000-0000-7000-8000-0000000000f1",
      "00000000-0000-7000-8000-0000000000f2",
      "00000000-0000-7000-8000-0000000000f3",
    ];

    try {
      for (const id of ids) {
        await publisher.publish(channel, {
          kind: "event",
          id,
          name: "member.changed",
          at: new Date("2026-01-01T00:00:00Z"),
          payload: {},
        });
      }

      const controller = new AbortController();
      const received: string[] = [];
      for await (const message of subscriber.subscribe([channel], controller.signal, {
        after: ids[0],
      })) {
        received.push(message.id);
        if (received.length === 2) break;
      }
      controller.abort();

      expect(received).toEqual(ids.slice(1));
      expect(await redis.client().ttl(`realtime:log:${channel}`)).toBeGreaterThan(0);
    } finally {
      await redis.client().del(`realtime:log:${channel}`);
    }
  });

  // PING is one of the eight commands valid in subscriber mode, and it answers
  // `["pong", ""]` there rather than the simple string the other connections answer.
  it("answers healthy on a connection that is in subscriber mode", async () => {
    const subscriber = new RedisRealtimeSubscriber(() => redis.subscriberClient(), {
      maxStreamsPerUser: 8,
      maxAgeMs: 5_000,
      queueSize: 8,
    });
    const controller = new AbortController();

    // Checked while the stream is open. The previous shape let the generator finish
    // first, which unsubscribes — and a connection that has left subscriber mode passes.
    const reading = (async () => {
      for await (const _ of subscriber.subscribe([CHANNEL], controller.signal)) break;
    })();
    await new Promise((resolve) => setTimeout(resolve, 150));

    try {
      expect(redis.opened("subscriber")).toBe(true);
      expect(await redis.healthy("subscriber")).toBe(true);
    } finally {
      controller.abort();
      await reading;
    }
  });
});

describe("QueuePublisher against the running queue instance", () => {
  // Its own queue, never `QueueName.MAINTENANCE`: a running worker consumes that one and
  // these probes carry no job it can run, so it logged `queue.job.failed` on every smoke.
  // ──
  // `publish` takes a string, so this costs no enum member for a queue nothing owns.
  const SMOKE_QUEUE = "smoke";

  const queue = () => new Queue(SMOKE_QUEUE, { connection: redis.queueClient() });

  // The port's whole write surface, and its only exercised path anywhere: a fake would
  // prove that BullMQ's client accepts the arguments, not that a job lands on a queue.
  it("publishes a job that is on the queue under the id it was given", async () => {
    const publisher = new BullMqQueuePublisher(redis.queueClient());
    // Read back through BullMQ rather than off a Redis key: the key layout is theirs to
    // change, and a spec that pins it fails on an upgrade that broke nothing.
    const reader = queue();

    try {
      await publisher.publish(SMOKE_QUEUE, { probe: true }, { jobId: "smoke-probe" });
      const job = await reader.getJob("smoke-probe");

      expect(job?.data).toEqual({ probe: true });
      // From the port's defaults: minutes of retries, and both sets bounded, because on a
      // `noeviction` instance BullMQ would otherwise keep every job forever.
      expect(job?.opts.attempts).toBe(8);
      expect(job?.opts.backoff).toMatchObject({ type: "exponential", delay: 5_000 });
      expect(job?.opts.removeOnComplete).toBeTruthy();
      expect(job?.opts.removeOnFail).toMatchObject({ count: 10_000 });
    } finally {
      await (await reader.getJob("smoke-probe"))?.remove();
      await reader.close();
      await publisher.close();
    }
  });

  // `CP4.1`: a fan-out's jobs go in one `addBulk`, and each keeps its own id and options.
  it("publishes many jobs at once, each under its own id", async () => {
    const publisher = new BullMqQueuePublisher(redis.queueClient());
    const reader = queue();
    const ids = ["smoke-bulk-1", "smoke-bulk-2", "smoke-bulk-3"];

    try {
      await publisher.publishMany(
        SMOKE_QUEUE,
        ids.map((jobId, index) => ({ payload: { index }, options: { jobId, attempts: 2 } })),
      );

      for (const [index, jobId] of ids.entries()) {
        const job = await reader.getJob(jobId);
        expect(job?.data).toEqual({ index });
        expect(job?.opts.attempts).toBe(2);
      }
    } finally {
      for (const jobId of ids) await (await reader.getJob(jobId))?.remove();
      await reader.close();
      await publisher.close();
    }
  });

  // `CR.18`. An operator's request is one job while one is queued or running, and a new
  // one after: a fixed `jobId` swallowed a retry for as long as the failed job was kept.
  it("dedupes an in-flight id only while a job holding it is on the queue", async () => {
    const publisher = new BullMqQueuePublisher(redis.queueClient());
    const reader = queue();
    const waiting = async () =>
      (await reader.getJobs(["waiting"])).filter((job) => job.data.inFlight);

    try {
      await publisher.publish(SMOKE_QUEUE, { inFlight: 1 }, { inFlightId: "smoke-in-flight" });
      await publisher.publish(SMOKE_QUEUE, { inFlight: 2 }, { inFlightId: "smoke-in-flight" });
      expect((await waiting()).map((job) => job.data.inFlight)).toEqual([1]);

      for (const job of await waiting()) await job.remove();
      await publisher.publish(SMOKE_QUEUE, { inFlight: 3 }, { inFlightId: "smoke-in-flight" });
      expect((await waiting()).map((job) => job.data.inFlight)).toEqual([3]);
    } finally {
      for (const job of await waiting()) await job.remove();
      await reader.close();
      await publisher.close();
    }
  });

  // `RV.5`. The job completes and is trimmed at once, as a big digest's early pages are.
  // `job.remove()` would not do: it deletes the dedupe key too, which trimming does not.
  it("dedupes a onceWithin id after its job completed and was trimmed", async () => {
    const name = `${SMOKE_QUEUE}-once-within-${Date.now()}`;
    const publisher = new BullMqQueuePublisher(redis.queueClient());
    const reader = new Queue(name, { connection: redis.queueClient() });
    const ran: number[] = [];
    const worker = new Worker(name, (job) => Promise.resolve(void ran.push(job.data.n)), {
      connection: redis.queueClient(),
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 1_000));
    const once = (n: number) =>
      publisher.publish(
        name,
        { n },
        { onceWithin: { id: "mail", seconds: 3 }, removeOnCompleteAgeSeconds: 0 },
      );

    try {
      await once(1);
      await settle();
      expect(await reader.getJobCounts("completed", "waiting")).toMatchObject({
        completed: 0,
        waiting: 0,
      });

      await once(2);
      await settle();
      expect(ran).toEqual([1]);

      await new Promise((resolve) => setTimeout(resolve, 2_200));
      await once(3);
      await settle();
      expect(ran).toEqual([1, 3]);
    } finally {
      await worker.close();
      await reader.obliterate({ force: true });
      await reader.close();
      await publisher.close();
    }
  });

  // The deduplication key is a business rule the port carries, not queue configuration:
  // "enqueue OCR for this receipt, once" has to mean once.
  it("does not enqueue a second job under an id already on the queue", async () => {
    const publisher = new BullMqQueuePublisher(redis.queueClient());
    const reader = queue();

    try {
      await publisher.publish(SMOKE_QUEUE, { attempt: 1 }, { jobId: "smoke-once" });
      await publisher.publish(SMOKE_QUEUE, { attempt: 2 }, { jobId: "smoke-once" });

      expect((await reader.getJob("smoke-once"))?.data).toEqual({ attempt: 1 });
    } finally {
      await (await reader.getJob("smoke-once"))?.remove();
      await reader.close();
      await publisher.close();
    }
  });

  // Both defaulted, and both only observable on a real queue: the job name is what a
  // consumer switches on, and priority is how mail nobody can sign up without goes first.
  it("carries the job name and priority the caller asked for", async () => {
    const publisher = new BullMqQueuePublisher(redis.queueClient());
    const reader = queue();

    try {
      await publisher.publish(
        SMOKE_QUEUE,
        { probe: true },
        { jobId: "smoke-named", name: "partitions", priority: 1 },
      );
      const job = await reader.getJob("smoke-named");

      expect(job?.name).toBe("partitions");
      expect(job?.opts.priority).toBe(1);
    } finally {
      await (await reader.getJob("smoke-named"))?.remove();
      await reader.close();
      await publisher.close();
    }
  });

  // The default the four call sites above rely on: a queue carrying one kind of work
  // names no job, and BullMQ still needs a name.
  it("names the job after the queue when the caller passes none", async () => {
    const publisher = new BullMqQueuePublisher(redis.queueClient());
    const reader = queue();

    try {
      await publisher.publish(SMOKE_QUEUE, { probe: true }, { jobId: "smoke-unnamed" });

      expect((await reader.getJob("smoke-unnamed"))?.name).toBe(SMOKE_QUEUE);
    } finally {
      await (await reader.getJob("smoke-unnamed"))?.remove();
      await reader.close();
      await publisher.close();
    }
  });
});

// `CP5.1`: live frames get a role of their own, which costs nothing until it is set apart.
describe("RedisConnection's realtime role", () => {
  it("is the cache client itself when no realtime instance is configured", async () => {
    const connection = new RedisConnection(stack.redis);
    try {
      expect(connection.realtimeClient()).toBe(connection.client());
      expect(connection.opened("realtime")).toBe(false);
    } finally {
      await connection.close();
    }
  });

  // The queue instance stands in for a third one: pub/sub ignores the database index, so
  // a `/1` on the cache URL would prove nothing. Lite runs one instance, so it skips.
  it.skipIf(stack.redis.queueUrl === stack.redis.cacheUrl)(
    "is its own connection, to its own instance, when one is configured",
    async () => {
      const connection = new RedisConnection({ ...stack.redis, realtimeUrl: stack.redis.queueUrl });
      try {
        expect(connection.realtimeClient()).not.toBe(connection.client());
        expect(await connection.healthy("realtime")).toBe(true);
      } finally {
        await connection.close();
      }
    },
  );

  // A stream's `finally` runs after shutdown has closed Redis, and must not reopen it.
  it("refuses to open a connection once closed", async () => {
    const connection = new RedisConnection(stack.redis);
    connection.client();
    await connection.close();

    expect(() => connection.subscriberClient()).toThrow(/closed/);
  });
});
