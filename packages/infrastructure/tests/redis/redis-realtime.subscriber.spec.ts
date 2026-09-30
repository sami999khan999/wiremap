import { RealtimeChannels } from "@loadbearing/application";
import { describe, expect, it } from "vitest";
import type { RealtimeChannel, RealtimeMessage, Redis } from "../../src/import.js";
import { RedisRealtimeSubscriber } from "../../src/redis/redis-realtime.subscriber.js";

// Enough of ioredis to drive the demux: the commands the adapter issues, and the push
// channel it listens on. A live instance proves the round trip; this proves the branches.
class FakeRedis {
  public readonly subscribed: string[] = [];
  public readonly unsubscribed: string[] = [];
  private handler: ((channel: string, payload: string) => void) | null = null;

  public subscribe(channel: string): Promise<number> {
    this.subscribed.push(channel);
    return Promise.resolve(this.subscribed.length);
  }

  public unsubscribe(channel: string): Promise<number> {
    this.unsubscribed.push(channel);
    return Promise.resolve(0);
  }

  public on(_event: "message", handler: (channel: string, payload: string) => void): this {
    this.handler = handler;
    return this;
  }

  public deliver(channel: string, payload: string): void {
    this.handler?.(channel, payload);
  }

  public open(): readonly string[] {
    return this.subscribed.filter((channel) => !this.unsubscribed.includes(channel));
  }
}

const ORG = "00000000-0000-7000-8000-000000000001";
const USER = "00000000-0000-7000-8000-000000000002";
const CHANNEL = RealtimeChannels.user(ORG, USER);

const CONFIG = { maxStreamsPerUser: 8, maxAgeMs: 60_000, queueSize: 4 };

const build = (overrides: Partial<typeof CONFIG> = {}) => {
  const redis = new FakeRedis();
  const subscriber = new RedisRealtimeSubscriber(() => redis as unknown as Redis, {
    ...CONFIG,
    ...overrides,
  });
  return { redis, subscriber };
};

const frame = (id: string) =>
  JSON.stringify({
    kind: "event",
    id,
    name: "member.changed",
    at: "2026-01-01T00:00:00.000Z",
    payload: {},
  });

// Collects until `count` frames have arrived, then aborts. Every spec here would
// otherwise park on a generator waiting for a publish that is not coming.
async function take(
  stream: AsyncIterable<RealtimeMessage>,
  count: number,
  controller: AbortController,
): Promise<readonly RealtimeMessage[]> {
  const received: RealtimeMessage[] = [];

  for await (const message of stream) {
    received.push(message);
    if (received.length >= count) break;
  }

  controller.abort();
  return received;
}

describe("RedisRealtimeSubscriber", () => {
  it("subscribes once per channel and yields the frames it parses", async () => {
    const { redis, subscriber } = build();
    const controller = new AbortController();

    const reading = take(subscriber.subscribe([CHANNEL], controller.signal), 1, controller);
    await Promise.resolve();

    redis.deliver(CHANNEL, frame("00000000-0000-7000-8000-00000000000a"));
    const received = await reading;

    expect(redis.subscribed).toEqual([CHANNEL]);
    expect(received.map((message) => message.id)).toEqual(["00000000-0000-7000-8000-00000000000a"]);
  });

  // `at` crosses the wire as a string. A reader handed the raw JSON would hold a value
  // typed `Date` that is not one, and the failure surfaces wherever it is first compared.
  it("coerces the timestamp rather than passing the string through", async () => {
    const { redis, subscriber } = build();
    const controller = new AbortController();

    const reading = take(subscriber.subscribe([CHANNEL], controller.signal), 1, controller);
    await Promise.resolve();

    redis.deliver(CHANNEL, frame("00000000-0000-7000-8000-00000000000b"));
    const [received] = await reading;

    expect(received?.kind).toBe("event");
    if (received?.kind === "event") expect(received.at).toBeInstanceOf(Date);
  });

  it("drops a frame that is not a message rather than ending the stream", async () => {
    const { redis, subscriber } = build();
    const controller = new AbortController();

    const reading = take(subscriber.subscribe([CHANNEL], controller.signal), 1, controller);
    await Promise.resolve();

    redis.deliver(CHANNEL, "{not json");
    redis.deliver(CHANNEL, JSON.stringify({ kind: "nonsense" }));
    redis.deliver(CHANNEL, frame("00000000-0000-7000-8000-00000000000c"));

    expect((await reading).map((message) => message.id)).toEqual([
      "00000000-0000-7000-8000-00000000000c",
    ]);
  });

  // The overflow contract. The reader loses frames it never saw and is told so, which
  // costs it a refetch — the alternative is a slow tab costing the process memory.
  it("emits a resync when the queue overflows, and keeps the newest frames", async () => {
    const { redis, subscriber } = build({ queueSize: 2 });
    const controller = new AbortController();
    const received: RealtimeMessage[] = [];

    const reading = (async () => {
      for await (const message of subscriber.subscribe([CHANNEL], controller.signal)) {
        received.push(message);
        if (received.length >= 3) break;
      }
      controller.abort();
    })();

    await Promise.resolve();
    for (const id of ["a", "b", "c", "d"]) {
      redis.deliver(CHANNEL, frame(`00000000-0000-7000-8000-00000000000${id}`));
    }
    await reading;

    expect(received[0]?.kind).toBe("resync");
    expect(received.slice(1).map((message) => message.id)).toEqual([
      "00000000-0000-7000-8000-00000000000c",
      "00000000-0000-7000-8000-00000000000d",
    ]);
  });

  it("releases the channel when the last reader on it goes", async () => {
    const { redis, subscriber } = build();
    const first = new AbortController();
    const second = new AbortController();

    const one = (async () => {
      for await (const _ of subscriber.subscribe([CHANNEL], first.signal)) break;
    })();
    const two = (async () => {
      for await (const _ of subscriber.subscribe([CHANNEL], second.signal)) break;
    })();

    await Promise.resolve();
    await Promise.resolve();

    first.abort();
    await one;
    // One SUBSCRIBE for two readers, and the first leaving releases nothing.
    expect(redis.subscribed).toEqual([CHANNEL]);
    expect(redis.open()).toEqual([CHANNEL]);

    second.abort();
    await two;
    expect(redis.unsubscribed).toEqual([CHANNEL]);
  });

  it("refuses a stream past the per-user cap", async () => {
    const { subscriber } = build({ maxStreamsPerUser: 1 });
    const held = new AbortController();

    const one = (async () => {
      for await (const _ of subscriber.subscribe([CHANNEL], held.signal)) break;
    })();
    await Promise.resolve();

    const second = new AbortController();
    const refused = async () => {
      for await (const _ of subscriber.subscribe([CHANNEL], second.signal)) break;
    };

    await expect(refused()).rejects.toThrow("RATE_LIMITED");

    held.abort();
    await one;
  });

  // The cap counts user channels only. A conversation channel is one channel with many
  // readers, and counting it the same way would cap the room rather than the person.
  it("does not count a channel that is not a user channel", async () => {
    const { subscriber } = build({ maxStreamsPerUser: 1 });
    const room = `org:${ORG}:conversation:x` as RealtimeChannel;
    const first = new AbortController();
    const second = new AbortController();

    const one = (async () => {
      for await (const _ of subscriber.subscribe([room], first.signal)) break;
    })();
    await Promise.resolve();

    const two = (async () => {
      for await (const _ of subscriber.subscribe([room], second.signal)) break;
    })();
    await Promise.resolve();

    first.abort();
    second.abort();
    await Promise.all([one, two]);
  });

  it("ends the stream when its maximum age elapses, with nothing published", async () => {
    const { redis, subscriber } = build({ maxAgeMs: 5 });
    const controller = new AbortController();
    const received: RealtimeMessage[] = [];

    for await (const message of subscriber.subscribe([CHANNEL], controller.signal)) {
      received.push(message);
    }

    expect(received).toEqual([]);
    // And it let the channel go on the way out, rather than leaving the process
    // subscribed to a channel with no reader for as long as it runs.
    expect(redis.unsubscribed).toEqual([CHANNEL]);
  });

  // `CR.5`: counted against the person who opened it, a room stream shares the cap — the
  // room is still uncapped, because each reader brings their own owner.
  it("counts a room stream against its owner's cap", async () => {
    const { subscriber } = build({ maxStreamsPerUser: 1 });
    const room = `org:${ORG}:conversation:x` as RealtimeChannel;
    const held = new AbortController();

    const one = (async () => {
      for await (const _ of subscriber.subscribe([CHANNEL], held.signal)) break;
    })();
    await Promise.resolve();

    const second = new AbortController();
    const refused = async () => {
      for await (const _ of subscriber.subscribe([room], second.signal, { owner: CHANNEL })) break;
    };

    await expect(refused()).rejects.toThrow("RATE_LIMITED");
    held.abort();
    await one;
  });

  // A shutdown ends streams the way the maximum age does — cleanly — so a client reopens
  // against another process rather than treating it as an error.
  it("ends every open stream cleanly on drain, and counts them", async () => {
    const { redis, subscriber } = build();
    const controllers = [new AbortController(), new AbortController()];
    const ended = controllers.map(async (controller) => {
      for await (const _ of subscriber.subscribe([CHANNEL], controller.signal)) {
        // nothing is published; the loop only ends when the stream does
      }
      return "ended";
    });
    await Promise.resolve();
    await Promise.resolve();

    await expect(subscriber.drain(10)).resolves.toBe(2);
    await expect(Promise.all(ended)).resolves.toEqual(["ended", "ended"]);
    expect(redis.unsubscribed).toEqual([CHANNEL]);
  });

  it("drains nothing when nothing is open", async () => {
    const { subscriber } = build();

    await expect(subscriber.drain(10)).resolves.toBe(0);
  });
});

// Enough of a Redis Stream to answer `XRANGE - +`: the entries in order, one field each.
class FakeLog {
  public readonly entries: [string, string[]][] = [];

  public append(payload: string): void {
    this.entries.push([`${this.entries.length + 1}-0`, ["m", payload]]);
  }

  public xrange(): Promise<[string, string[]][]> {
    return Promise.resolve(this.entries);
  }
}

// `26.5`. A resume was always a resync: the tab threw its cache away and refetched every
// query it held, however little it had missed.
describe("RedisRealtimeSubscriber — a resume", () => {
  const A = "00000000-0000-7000-8000-00000000000a";
  const B = "00000000-0000-7000-8000-00000000000b";
  const C = "00000000-0000-7000-8000-00000000000c";

  const resumable = () => {
    const redis = new FakeRedis();
    const log = new FakeLog();
    const subscriber = new RedisRealtimeSubscriber(
      () => redis as unknown as Redis,
      CONFIG,
      () => log as unknown as Redis,
    );
    return { redis, log, subscriber };
  };

  it("replays what came after the last event the client saw, then goes live", async () => {
    const { redis, log, subscriber } = resumable();
    for (const id of [A, B, C]) log.append(frame(id));
    const controller = new AbortController();

    const reading = take(
      subscriber.subscribe([CHANNEL], controller.signal, { after: A }),
      3,
      controller,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    redis.deliver(CHANNEL, frame("00000000-0000-7000-8000-00000000000d"));

    expect((await reading).map((message) => message.id)).toEqual([
      B,
      C,
      "00000000-0000-7000-8000-00000000000d",
    ]);
  });

  // Heard live while the log was being read, and in the log too: once, not twice.
  it("drops a live frame the replay already carried", async () => {
    const { redis, log, subscriber } = resumable();
    for (const id of [A, B]) log.append(frame(id));
    const controller = new AbortController();

    const stream = subscriber.subscribe([CHANNEL], controller.signal, { after: A });
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();
    redis.deliver(CHANNEL, frame(B));
    redis.deliver(CHANNEL, frame(C));

    const received = [(await first).value, (await iterator.next()).value];
    controller.abort();
    await iterator.return?.();

    expect(received.map((message) => (message as RealtimeMessage).id)).toEqual([B, C]);
  });

  it("resyncs when the log no longer reaches back to the client's last event", async () => {
    const { log, subscriber } = resumable();
    log.append(frame(B));
    const controller = new AbortController();

    const [first] = await take(
      subscriber.subscribe([CHANNEL], controller.signal, { after: A }),
      1,
      controller,
    );

    expect(first?.kind).toBe("resync");
  });

  it("resyncs when it was built with no log to read", async () => {
    const { subscriber } = build();
    const controller = new AbortController();

    const [first] = await take(
      subscriber.subscribe([CHANNEL], controller.signal, { after: A }),
      1,
      controller,
    );

    expect(first?.kind).toBe("resync");
  });
});
