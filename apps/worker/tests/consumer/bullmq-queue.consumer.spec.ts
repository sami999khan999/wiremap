import type { Job } from "bullmq";
import { describe, expect, it } from "vitest";
import { BullMqQueueConsumer } from "../../src/consumer/bullmq-queue.consumer.js";

const bullJob = (attemptsMade: number, attempts?: number): Job =>
  ({
    id: "42",
    name: "send",
    data: { to: "a@example.test" },
    attemptsMade,
    opts: attempts === undefined ? {} : { attempts },
  }) as unknown as Job;

describe("BullMqQueueConsumer.envelope", () => {
  // `attemptsMade` counts the failures before this delivery, so the first run is attempt 1.
  it("numbers the first delivery as attempt 1", () => {
    expect(BullMqQueueConsumer.envelope(bullJob(0, 8))).toEqual({
      id: "42",
      name: "send",
      data: { to: "a@example.test" },
      attempt: 1,
      maxAttempts: 8,
    });
  });

  it("marks the last delivery as the last attempt", () => {
    const envelope = BullMqQueueConsumer.envelope(bullJob(7, 8));

    expect(envelope.attempt).toBe(envelope.maxAttempts);
  });

  // BullMQ's own default is one attempt.
  it("defaults to a single attempt when the job set none", () => {
    expect(BullMqQueueConsumer.envelope(bullJob(0)).maxAttempts).toBe(1);
  });
});
