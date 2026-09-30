import type { Container } from "../import.js";
import type { StreamListener } from "../server/index.js";

// What the drained line reports when the budget ran out before the streams did.
const TIMED_OUT = -1;

// Start and stop, and nothing between: every stream is a request the listener serves.
export class RealtimeBootstrap {
  private stopping: Promise<void> | null = null;

  public constructor(
    private readonly container: Container,
    private readonly listener: StreamListener,
    private readonly shutdownTimeoutMs: number,
  ) {}

  public async start(port: number): Promise<void> {
    await this.listener.listen(port);
    this.container.logger.emit("process.started", { service: "realtime" });
  }

  // Idempotent: a second signal joins the stop already running rather than cutting it.
  public stop(signal: string): Promise<void> {
    this.stopping ??= this.drain(signal);
    return this.stopping;
  }

  // Streams end cleanly, spread over half the budget, so each client reopens onto another
  // replica at its own moment. See docs/reference/shutdown.md.
  private async drain(signal: string): Promise<void> {
    this.container.logger.emit("process.stopping", { service: "realtime", signal });
    const startedAt = Date.now();

    this.listener.stopAccepting();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const streams = await Promise.race([
      this.container.realtimeSubscriber.drain(this.shutdownTimeoutMs / 2),
      new Promise<number>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), this.shutdownTimeoutMs);
      }),
    ]);
    clearTimeout(timer);

    this.container.logger.emit("realtime.stream.drained", {
      streams,
      durationMs: Date.now() - startedAt,
    });

    // The drained streams finish writing inside what is left of the budget, and only what
    // is still open after that is cut.
    await this.listener.closed(Math.max(0, this.shutdownTimeoutMs - (Date.now() - startedAt)));
    this.listener.closeAll();
    await this.container.dispose();

    this.container.logger.emit("process.stopped", {
      service: "realtime",
      durationMs: Date.now() - startedAt,
    });
  }
}
