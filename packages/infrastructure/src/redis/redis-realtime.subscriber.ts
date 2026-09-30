import {
  type CancellationSignal,
  RateLimitedError,
  type RealtimeChannel,
  RealtimeChannels,
  RealtimeContract,
  type RealtimeMessage,
  RealtimeSubscriber,
  type Redis,
  type SubscribeOptions,
  Uuid,
} from "../import.js";
import { RealtimeLog } from "./realtime-log.js";

export interface RedisRealtimeConfig {
  readonly maxStreamsPerUser: number;
  readonly maxAgeMs: number;
  readonly queueSize: number;
}

type Sink = (message: RealtimeMessage) => void;

interface LiveStream {
  readonly endBy: (at: number) => void;
}

// One connection per process, demultiplexed here. A connection per stream would open one
// socket per open tab, which is the number that takes a Redis down rather than a replica.
export class RedisRealtimeSubscriber extends RealtimeSubscriber {
  private readonly sinks = new Map<string, Set<Sink>>();
  private readonly streamsPerChannel = new Map<string, number>();
  private readonly live = new Set<LiveStream>();
  private readonly idle: (() => void)[] = [];
  private listening = false;

  // A factory, not a client. Resolving the role here would open the subscriber socket in
  // every process that builds a container — see docs/reference/realtime.md.
  public constructor(
    private readonly connection: () => Redis,
    private readonly config: RedisRealtimeConfig,
    // A client not in subscriber mode, for reading the log on a resume. Without one every
    // resume is a resync, which is what it was before the log existed.
    private readonly log?: () => Redis,
  ) {
    super();
  }

  public override async *subscribe(
    channels: readonly RealtimeChannel[],
    signal: CancellationSignal,
    options?: SubscribeOptions,
  ): AsyncIterable<RealtimeMessage> {
    // Counted against the person who opened it, so conversation streams share the cap:
    // counting only user channels let one tab open any number of room streams.
    const capped = options?.owner
      ? [options.owner]
      : channels.filter((channel) => RealtimeChannels.isUser(channel));
    this.assertUnderCap(capped);

    const queue: RealtimeMessage[] = [];
    let dropped = false;
    let wake: (() => void) | null = null;

    const push = (message: RealtimeMessage) => {
      // Oldest first, because the newest frame is the one the reader has not seen and the
      // `resync` that replaces the lost ones costs a refetch either way.
      if (queue.length >= this.config.queueSize) {
        queue.shift();
        dropped = true;
      }
      queue.push(message);
      wake?.();
      wake = null;
    };
    const onAbort = () => {
      wake?.();
      wake = null;
    };

    // ±10 %, so tabs opened together after a deploy do not all reopen in the same second.
    let deadline = Date.now() + this.config.maxAgeMs * (0.9 + 0.2 * Math.random());
    // What `drain` reaches: it can only bring the deadline forward, never push it back.
    const live: LiveStream = {
      endBy: (at) => {
        deadline = Math.min(deadline, at);
        wake?.();
        wake = null;
      },
    };
    this.live.add(live);
    signal.addEventListener("abort", onAbort);
    for (const channel of capped) this.count(channel, 1);

    try {
      await this.attach(channels, push);
      // After the attach, so nothing published between the read and the subscribe is lost;
      // a frame both read and heard is dropped from the live queue by its id.
      if (options?.after !== undefined) await this.resume(channels, options.after, queue);

      while (!signal.aborted && Date.now() < deadline) {
        if (dropped) {
          dropped = false;
          yield { kind: "resync", id: Uuid.v7() };
          continue;
        }

        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }

        await this.park(deadline, (resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      for (const channel of capped) this.count(channel, -1);
      await this.detach(channels, push);
      this.live.delete(live);
      if (this.live.size === 0) for (const settle of this.idle.splice(0)) settle();
    }
  }

  public override async drain(withinMs: number): Promise<number> {
    const streams = this.live.size;
    if (streams === 0) return 0;

    const settled = new Promise<void>((resolve) => {
      this.idle.push(resolve);
    });
    const now = Date.now();
    for (const live of this.live) live.endBy(now + Math.random() * withinMs);

    await settled;
    return streams;
  }

  // What the stream missed, ahead of anything heard live; a resync when the log cannot
  // answer. One channel only: two logs share no order a single `lastEventId` could name.
  private async resume(
    channels: readonly RealtimeChannel[],
    after: string,
    queue: RealtimeMessage[],
  ): Promise<void> {
    const [channel] = channels;
    const missed =
      channel !== undefined && channels.length === 1 && this.log
        ? await RealtimeLog.since(this.log(), channel, after).catch(() => null)
        : null;

    if (missed === null) {
      queue.unshift({ kind: "resync", id: Uuid.v7() });
      return;
    }

    const replayed = new Set(missed.map((message) => message.id));
    const live = queue.splice(0).filter((message) => !replayed.has(message.id));
    queue.push(...missed, ...live);
  }

  private assertUnderCap(channels: readonly RealtimeChannel[]): void {
    for (const channel of channels) {
      const open = this.streamsPerChannel.get(channel) ?? 0;
      // Per process, not per cluster. A cap that needed a shared counter would need a
      // round trip on every stream open, and the failure it prevents is one runaway tab.
      if (open >= this.config.maxStreamsPerUser) {
        throw new RateLimitedError("realtime.stream");
      }
    }
  }

  private count(channel: RealtimeChannel, delta: number): void {
    const next = (this.streamsPerChannel.get(channel) ?? 0) + delta;
    if (next <= 0) this.streamsPerChannel.delete(channel);
    else this.streamsPerChannel.set(channel, next);
  }

  // Resolves either when a frame arrives or when the stream's age runs out, so a channel
  // that never publishes again does not hold the generator open past its deadline.
  private park(deadline: number, register: (resolve: () => void) => void): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      register(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async attach(channels: readonly RealtimeChannel[], sink: Sink): Promise<void> {
    this.listen();

    for (const channel of channels) {
      const existing = this.sinks.get(channel);
      if (existing) {
        existing.add(sink);
        continue;
      }

      this.sinks.set(channel, new Set([sink]));
      await this.connection().subscribe(channel);
    }
  }

  // Ref-counted: the last reader off a channel is what releases it, and a channel left
  // subscribed is a frame delivered to nobody on every publish for the life of the process.
  private async detach(channels: readonly RealtimeChannel[], sink: Sink): Promise<void> {
    for (const channel of channels) {
      const existing = this.sinks.get(channel);
      if (!existing) continue;

      existing.delete(sink);
      if (existing.size > 0) continue;

      this.sinks.delete(channel);
      // A stream ending during shutdown finds the connection already closed, and there is
      // nothing left to unsubscribe from.
      await Promise.resolve()
        .then(() => this.connection().unsubscribe(channel))
        .catch(() => undefined);
    }
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;

    this.connection().on("message", (channel: string, payload: string) => {
      const sinks = this.sinks.get(channel);
      if (!sinks || sinks.size === 0) return;

      // Parsed, not cast. `at` crosses as a string and the contract coerces it, so a
      // reader handed the raw JSON would get a `Date`-typed value that is not one.
      const parsed = RealtimeContract.message.safeParse(this.decode(payload));
      if (!parsed.success) return;

      for (const sink of sinks) sink(parsed.data);
    });
  }

  private decode(payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
}
