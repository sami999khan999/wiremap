import {
  type RealtimeChannel,
  RealtimeContract,
  type RealtimeMessage,
  type Redis,
} from "../import.js";

// A short history per channel beside the pub/sub, so a stream that resumes is replayed what
// it missed rather than told to refetch everything (`26.5`). One Redis Stream per channel.
export class RealtimeLog {
  // Frames kept per channel. A tab that missed more than this refetches, as it always did.
  public static readonly LENGTH = 200;

  // A channel nobody has published to for an hour drops its log, so the history is bounded
  // by activity and not by how many channels have ever existed.
  public static readonly TTL_SECONDS = 3_600;

  private constructor() {}

  public static keyOf(channel: RealtimeChannel): string {
    return `realtime:log:${channel}`;
  }

  // Everything after `after`, oldest first; null when `after` is not in the log — trimmed,
  // expired, or never logged — which is the case a resync still answers.
  public static async since(
    redis: Redis,
    channel: RealtimeChannel,
    after: string,
  ): Promise<readonly RealtimeMessage[] | null> {
    const entries = await redis.xrange(RealtimeLog.keyOf(channel), "-", "+");
    const messages: RealtimeMessage[] = [];

    for (const [, fields] of entries) {
      const parsed = RealtimeContract.message.safeParse(RealtimeLog.decode(fields[1]));
      if (parsed.success) messages.push(parsed.data);
    }

    const at = messages.findIndex((message) => message.id === after);
    return at === -1 ? null : messages.slice(at + 1);
  }

  private static decode(payload: string | undefined): unknown {
    try {
      return JSON.parse(payload ?? "");
    } catch {
      return null;
    }
  }
}
