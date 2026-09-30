import { type RealtimeChannel, type RealtimeMessage, RealtimePublisher } from "../import.js";
import type { InMemoryRealtimeHub } from "./in-memory-realtime.hub.js";

export interface PublishedFrame {
  readonly channel: string;
  readonly message: RealtimeMessage;
}

// Records rather than reaching Redis. The assertion worth writing is "the member's own
// channel got one frame", and the channel string is the whole of the tenancy claim.
export class RecordingRealtimePublisher extends RealtimePublisher {
  private readonly frames: PublishedFrame[] = [];

  // The hub is optional because most specs only ask what was published. Pass one when the
  // assertion is about a reader receiving it.
  public constructor(private readonly hub?: InMemoryRealtimeHub) {
    super();
  }

  public override publish(channel: RealtimeChannel, message: RealtimeMessage): Promise<void> {
    this.frames.push({ channel, message });
    this.hub?.publish(channel, message);
    return Promise.resolve();
  }

  public published(): readonly PublishedFrame[] {
    return this.frames;
  }

  public publishedOn(channel: string): readonly PublishedFrame[] {
    return this.frames.filter((frame) => frame.channel === channel);
  }
}
