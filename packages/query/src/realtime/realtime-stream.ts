import { ERROR_CATALOG, ErrorNormalizer } from "../import.js";

// Doubling from one second, capped: a deploy that takes a minute is retried a handful of
// times per tab rather than thirty.
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
// A stream that stayed up this long was healthy, so the next failure starts from the bottom.
const HEALTHY_AFTER_MS = 60_000;

export interface RealtimeStreamOptions<T extends { readonly id: string; readonly kind: string }> {
  // `lastEventId` is set on every reopen, which is what makes the server answer `resync`.
  readonly open: (
    signal: AbortSignal,
    lastEventId: string | undefined,
  ) => Promise<AsyncIterable<T>>;
  readonly onFrame: (frame: T) => void;
  readonly onConnected: (connected: boolean) => void;
  readonly signal: AbortSignal;
}

// The one reconnect loop both streams use. The oRPC retry plugin only reopens on a throw,
// and a stream that reached its maximum age ends cleanly — which left every tab silent.
export class RealtimeStream {
  private constructor() {}

  public static async run<T extends { readonly id: string; readonly kind: string }>(
    options: RealtimeStreamOptions<T>,
  ): Promise<void> {
    const { signal } = options;
    let attempt = 0;
    let lastEventId: string | undefined;
    let opened = false;

    while (!signal.aborted) {
      const startedAt = Date.now();
      let delay: number;

      try {
        const stream = await options.open(
          signal,
          opened ? (lastEventId ?? RealtimeStream.anyId()) : undefined,
        );
        opened = true;
        options.onConnected(true);

        for await (const frame of stream) {
          if (signal.aborted) return;
          // Only an event is in the server's replay log. A typing or resync id resumed from
          // nothing, so every reopen in a busy conversation became a full resync.
          if (frame.kind === "event") lastEventId = frame.id;
          options.onFrame(frame);
        }

        // A clean end is the server's maximum age or its shutdown drain: reopen soon, spread.
        attempt = 0;
        delay = Math.random() * BASE_DELAY_MS;
      } catch (error) {
        if (signal.aborted) return;
        options.onConnected(false);

        const { code } = ErrorNormalizer.normalize(error);
        const entry = ERROR_CATALOG[code];
        // Signed out, forbidden, gone: asking again every few seconds gets the same answer.
        if (!entry.retryable && entry.severity === "expected") return;

        if (Date.now() - startedAt >= HEALTHY_AFTER_MS) attempt = 0;
        delay = RealtimeStream.backoff(attempt, code === "RATE_LIMITED");
        attempt += 1;
      }

      options.onConnected(false);
      await RealtimeStream.sleep(delay, signal);
    }
  }

  // Full jitter, so a thousand tabs dropped by one deploy do not come back in step.
  public static backoff(attempt: number, rateLimited: boolean): number {
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
    const delay = Math.random() * ceiling;
    return rateLimited ? Math.max(MAX_DELAY_MS, delay) : delay;
  }

  // Any valid id will do: the server only reads that one was sent, and answers `resync`.
  private static anyId(): string {
    return globalThis.crypto.randomUUID();
  }

  private static sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
