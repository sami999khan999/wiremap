import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamRevalidation } from "../../src/router/stream-revalidation.js";

// `CR.4`. A stream was authorized when it opened and then trusted for its thirty minutes,
// so a removed or deactivated member kept receiving frames.
describe("StreamRevalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the stream the first time the check says no", async () => {
    let allowed = true;
    const watched = StreamRevalidation.watch(
      new AbortController().signal,
      () => Promise.resolve(allowed),
      1_000,
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(watched.signal.aborted).toBe(false);

    allowed = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(watched.signal.aborted).toBe(true);
    watched.stop();
  });

  // A database blip is not a revocation: dropping every open tab at once would put them
  // all back on the reconnect path together.
  it("keeps the stream when the check itself fails", async () => {
    const watched = StreamRevalidation.watch(
      new AbortController().signal,
      () => Promise.reject(new Error("catalog down")),
      1_000,
    );

    await vi.advanceTimersByTimeAsync(3_000);

    expect(watched.signal.aborted).toBe(false);
    watched.stop();
  });

  it("still ends with the request, and asks nothing once stopped", async () => {
    const request = new AbortController();
    const allowed = vi.fn(() => Promise.resolve(true));
    const watched = StreamRevalidation.watch(request.signal, allowed, 1_000);

    request.abort();
    expect(watched.signal.aborted).toBe(true);

    watched.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(allowed).not.toHaveBeenCalled();
  });

  // `RV.4`. A check slower than the interval queued a second one behind it, per stream,
  // on a pool of five.
  it("starts no check while the last one is still out", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const allowed = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const watched = StreamRevalidation.watch(new AbortController().signal, allowed, 1_000);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(allowed).toHaveBeenCalledTimes(1);

    finish(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(allowed).toHaveBeenCalledTimes(2);
    watched.stop();
  });
});
