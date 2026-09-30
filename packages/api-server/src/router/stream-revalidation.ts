// A stream is authorized when it opens and then held for up to thirty minutes, so it asks
// again on an interval and ends when the answer is no (`CR.4`).
export class StreamRevalidation {
  private constructor() {}

  // A signal that aborts with `signal` or when `allowed` says no. A check that throws
  // keeps the stream: a database blip must not drop every open tab at once.
  public static watch(
    signal: AbortSignal,
    allowed: () => Promise<boolean>,
    everyMs: number,
  ): { readonly signal: AbortSignal; readonly stop: () => void } {
    const revoked = new AbortController();
    let checking = false;
    const timer = setInterval(() => {
      // A tick while the last check is still out is skipped: under a slow pool, stacking
      // them would queue one more query per stream per interval onto the same five.
      if (checking) return;
      checking = true;
      allowed()
        .then(
          (ok) => {
            if (!ok) revoked.abort();
          },
          () => undefined,
        )
        .finally(() => {
          checking = false;
        });
    }, everyMs);
    timer.unref();

    return { signal: AbortSignal.any([signal, revoked.signal]), stop: () => clearInterval(timer) };
  }
}
