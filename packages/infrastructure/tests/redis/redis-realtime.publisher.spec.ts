import { describe, expect, it } from "vitest";
import type { RealtimeChannel, RealtimeMessage, Redis } from "../../src/import.js";
import { RedisRealtimePublisher } from "../../src/redis/redis-realtime.publisher.js";
import { RecordingLogger } from "../support/recording.logger.js";

type Pair = [Error | null, unknown];

// Only the `MULTI` chain `publish` builds. What is pinned is how the publisher reads
// `exec`'s answer, which a live Redis will not fail on demand.
class FakeRedis {
  public constructor(private readonly answer: Pair[] | null) {}

  public multi(): FakeMulti {
    return new FakeMulti(this.answer);
  }
}

class FakeMulti {
  public constructor(private readonly answer: Pair[] | null) {}

  public xadd(): this {
    return this;
  }

  public expire(): this {
    return this;
  }

  public publish(): this {
    return this;
  }

  public exec(): Promise<Pair[] | null> {
    return Promise.resolve(this.answer);
  }
}

const CHANNEL = "user:a" as RealtimeChannel;

const MESSAGE: RealtimeMessage = {
  kind: "event",
  id: "01a0ee7c-4f0f-71c6-841b-cf29e351a522",
  name: "message.sent",
  at: new Date("2026-09-30T00:00:00Z"),
  payload: {},
};

const publish = async (answer: Pair[] | null) => {
  const logger = new RecordingLogger();
  const publisher = new RedisRealtimePublisher(new FakeRedis(answer) as unknown as Redis, logger);
  await publisher.publish(CHANNEL, MESSAGE);
  return logger.entries.map((entry) => ({ event: entry.event, fields: entry.fields }));
};

describe("RedisRealtimePublisher", () => {
  it("logs nothing when every command in the MULTI succeeds", async () => {
    await expect(
      publish([
        [null, "1-0"],
        [null, 1],
        [null, 1],
      ]),
    ).resolves.toEqual([]);
  });

  // The regression guard: ioredis resolves `exec` with the failure inside a pair, so a
  // failed XADD used to pass silently and a later resume found no frame.
  it("emits realtime.publish.failed when one command inside the MULTI fails", async () => {
    await expect(
      publish([
        [new Error("OOM command not allowed"), null],
        [null, 1],
        [null, 1],
      ]),
    ).resolves.toEqual([{ event: "realtime.publish.failed", fields: { event: "message.sent" } }]);
  });

  it("emits realtime.publish.failed when the transaction is aborted", async () => {
    await expect(publish(null)).resolves.toEqual([
      { event: "realtime.publish.failed", fields: { event: "message.sent" } },
    ]);
  });
});
