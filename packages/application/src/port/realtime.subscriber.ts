import type { RealtimeMessage } from "../import.js";
import type { CancellationSignal, RealtimeChannel } from "../primitive/index.js";

export interface SubscribeOptions {
  // Whose stream this is, for the per-person cap: the user channel of the principal that
  // opened it. Without it only user channels count, and conversation streams go uncapped.
  readonly owner?: RealtimeChannel;
  // The last frame id the client saw, on a resume. What came after it is replayed when the
  // adapter still holds it, and a `resync` says it does not — `26.5`.
  readonly after?: string;
}

// The stream ends when `signal` aborts or the maximum age elapses. A resume replays what
// the adapter still holds and resyncs past it; a first open replays nothing.
export abstract class RealtimeSubscriber {
  public abstract subscribe(
    channels: readonly RealtimeChannel[],
    signal: CancellationSignal,
    options?: SubscribeOptions,
  ): AsyncIterable<RealtimeMessage>;

  // Ends every open stream cleanly at a random point inside `withinMs` — a clean end is what
  // a client reopens from, so a shutdown hands its tabs on spread out. Resolves with the count.
  public abstract drain(withinMs: number): Promise<number>;
}
