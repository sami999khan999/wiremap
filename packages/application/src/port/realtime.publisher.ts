import type { RealtimeMessage } from "../import.js";
import type { RealtimeChannel } from "../primitive/index.js";

// Fire and forget, and it is not a queue: a frame nobody is listening for is kept only
// as long as the adapter's short replay log keeps it, and past that the client refetches.
export abstract class RealtimePublisher {
  public abstract publish(channel: RealtimeChannel, message: RealtimeMessage): Promise<void>;
}
