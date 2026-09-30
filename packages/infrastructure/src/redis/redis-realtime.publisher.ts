import type {
  Logger,
  RealtimeChannel,
  RealtimeMessage,
  RealtimePublisher,
  Redis,
} from "../import.js";
import { RealtimeLog } from "./realtime-log.js";

// On the cache client rather than the queue one: pub/sub is fire-and-forget, so the
// queue instance's durability guarantee buys nothing and its eviction policy is wasted.
export class RedisRealtimePublisher implements RealtimePublisher {
  public constructor(
    private readonly redis: Redis,
    private readonly logger?: Logger,
  ) {}

  // Best effort, and the swallow is here rather than at each call site: a frame is an
  // invalidation of something the client can fetch, so losing one costs a stale screen.
  public async publish(channel: RealtimeChannel, message: RealtimeMessage): Promise<void> {
    const payload = JSON.stringify(message);
    try {
      // A typing frame is stale in seconds and is never replayed, so it is never logged.
      if (message.kind !== "event") {
        await this.redis.publish(channel, payload);
        return;
      }

      // Logged before it is published, in one `MULTI`: a stream that resumes on this
      // frame's id has to find it in the log, or it falls back to a resync.
      const key = RealtimeLog.keyOf(channel);
      const results = await this.redis
        .multi()
        .xadd(key, "MAXLEN", "~", RealtimeLog.LENGTH, "*", "m", payload)
        .expire(key, RealtimeLog.TTL_SECONDS)
        .publish(channel, payload)
        .exec();

      // `exec` resolves with an `[error, result]` pair per command rather than throwing, so
      // a failed `XADD` would otherwise pass as a sent frame. Null is an aborted transaction.
      const failed = results?.find(([error]) => error !== null)?.[0];
      if (!results || failed) throw failed ?? new Error("MULTI aborted");
    } catch {
      // The channel is per-person and would be a high-cardinality field on a line the
      // whole tenant produces. What matters is which event stopped arriving.
      this.logger?.emit("realtime.publish.failed", {
        event: message.kind === "event" ? message.name : message.kind,
      });
    }
  }
}
