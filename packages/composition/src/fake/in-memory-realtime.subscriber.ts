import {
  type CancellationSignal,
  type RealtimeChannel,
  type RealtimeMessage,
  RealtimeSubscriber,
  type SubscribeOptions,
  Uuid,
} from "../import.js";
import type { InMemoryRealtimeHub } from "./in-memory-realtime.hub.js";

// Unbounded, unlike the Redis adapter. The bounded queue and its `resync` marker exist to
// keep one slow tab from costing memory, and a spec has neither a slow tab nor memory.
export class InMemoryRealtimeSubscriber extends RealtimeSubscriber {
  private readonly live = new Set<() => void>();
  private readonly idle: (() => void)[] = [];

  public constructor(private readonly hub: InMemoryRealtimeHub) {
    super();
  }

  // At once rather than spread: a spec asserts that streams end, not when.
  public override async drain(_withinMs: number): Promise<number> {
    const streams = this.live.size;
    if (streams === 0) return 0;

    const settled = new Promise<void>((resolve) => {
      this.idle.push(resolve);
    });
    for (const end of this.live) end();
    await settled;
    return streams;
  }

  // No log: a resume is always a resync here, which is the adapter's answer when its log
  // no longer reaches back far enough.
  public override async *subscribe(
    channels: readonly RealtimeChannel[],
    signal: CancellationSignal,
    options?: SubscribeOptions,
  ): AsyncIterable<RealtimeMessage> {
    const queue: RealtimeMessage[] =
      options?.after === undefined ? [] : [{ kind: "resync", id: Uuid.v7() }];
    let wake: (() => void) | null = null;

    const push = (message: RealtimeMessage) => {
      queue.push(message);
      wake?.();
      wake = null;
    };
    // Waking on abort as well as on a frame is what stops the generator parking forever
    // on a channel that never publishes again.
    const onAbort = () => {
      wake?.();
      wake = null;
    };

    let ended = false;
    const end = () => {
      ended = true;
      onAbort();
    };

    const releases = channels.map((channel) => this.hub.listen(channel, push));
    signal.addEventListener("abort", onAbort);
    this.live.add(end);

    try {
      while (!signal.aborted && !ended) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      for (const release of releases) release();
      this.live.delete(end);
      if (this.live.size === 0) for (const settle of this.idle.splice(0)) settle();
    }
  }
}
