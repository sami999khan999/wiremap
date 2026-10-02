import { type RealtimeChannel, type RealtimeMessage, RealtimePublisher } from "../import.js";

// Publishes nowhere. With `realtime.driver: "none"` the browser polls instead of holding a
// stream, so a frame would cost Redis commands and reach nobody. See docs/scale/realtime.md.
export class NoopRealtimePublisher extends RealtimePublisher {
  public override publish(_channel: RealtimeChannel, _message: RealtimeMessage): Promise<void> {
    return Promise.resolve();
  }
}
