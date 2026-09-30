import type { RealtimeChannel, RealtimeMessage } from "../import.js";

type Sink = (message: RealtimeMessage) => void;

// The seam between the two realtime fakes. A spec publishes through one and reads through
// the other, which is the only way to assert "the member's own tab received this".
export class InMemoryRealtimeHub {
  private readonly sinks = new Map<string, Set<Sink>>();

  public publish(channel: RealtimeChannel, message: RealtimeMessage): void {
    for (const sink of this.sinks.get(channel) ?? []) sink(message);
  }

  // Returns its own removal rather than taking an id, so a caller cannot release
  // somebody else's listener by guessing one.
  public listen(channel: RealtimeChannel, sink: Sink): () => void {
    const existing = this.sinks.get(channel) ?? new Set<Sink>();
    existing.add(sink);
    this.sinks.set(channel, existing);

    return () => {
      existing.delete(sink);
      if (existing.size === 0) this.sinks.delete(channel);
    };
  }

  public listenerCount(channel: RealtimeChannel): number {
    return this.sinks.get(channel)?.size ?? 0;
  }
}
