import { UnauthorizedError, UnavailableError } from "@loadbearing/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeStream } from "../../src/realtime/realtime-stream.js";

interface Frame {
  readonly id: string;
  readonly kind: string;
}

const FRAME_A = { id: "00000000-0000-7000-8000-00000000000a", kind: "event" };

// Yields its frames and then ends cleanly, the way a stream at its maximum age does.
const ending = (frames: readonly Frame[]) =>
  Promise.resolve(
    (async function* () {
      for (const frame of frames) yield frame;
    })(),
  );

const parked = () =>
  Promise.resolve(
    (async function* (): AsyncGenerator<Frame> {
      await new Promise(() => {});
    })(),
  );

const start = (
  open: (signal: AbortSignal, lastEventId: string | undefined) => Promise<AsyncIterable<Frame>>,
) => {
  const controller = new AbortController();
  const frames: Frame[] = [];
  const done = RealtimeStream.run<Frame>({
    open,
    onFrame: (frame) => frames.push(frame),
    onConnected: () => {},
    signal: controller.signal,
  });
  return { controller, frames, done };
};

describe("RealtimeStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The defect it exists for: a stream that ended at its maximum age was never reopened.
  it("reopens a stream that ended cleanly, resuming from the last frame", async () => {
    const calls: (string | undefined)[] = [];
    const open = vi.fn((_signal: AbortSignal, lastEventId: string | undefined) => {
      calls.push(lastEventId);
      return calls.length === 1 ? ending([FRAME_A]) : parked();
    });
    const { controller } = start(open);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(calls).toEqual([undefined, FRAME_A.id]);
    controller.abort();
  });

  // `RV.2`: neither is in the replay log, so resuming from one always came back as a resync.
  it("resumes from the last event, not from a typing or resync frame after it", async () => {
    const calls: (string | undefined)[] = [];
    const typing = { id: "00000000-0000-7000-8000-00000000000b", kind: "typing" };
    const resync = { id: "00000000-0000-7000-8000-00000000000c", kind: "resync" };
    const { controller } = start((_signal, lastEventId) => {
      calls.push(lastEventId);
      return calls.length === 1 ? ending([FRAME_A, typing, resync]) : parked();
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(calls).toEqual([undefined, FRAME_A.id]);
    controller.abort();
  });

  // A reopen with no frame seen still has to ask for a resync, or the gap goes unnoticed.
  it("sends some last event id on a reopen even when no frame arrived", async () => {
    const calls: (string | undefined)[] = [];
    const { controller } = start((_signal, lastEventId) => {
      calls.push(lastEventId);
      return calls.length === 1 ? ending([]) : parked();
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(calls[1]).toMatch(/^[0-9a-f-]{36}$/);
    controller.abort();
  });

  // Signed out is an answer, not an outage: retrying it every two seconds was `CR.38`.
  it("stops on an error that asking again cannot change", async () => {
    const open = vi.fn(() => Promise.reject(new UnauthorizedError()));
    const { done } = start(open);

    await done;

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("backs off with growing delays on an outage", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const open = vi.fn(() => Promise.reject(new UnavailableError("realtime")));
    const { controller } = start(open);

    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(open).toHaveBeenCalledTimes(2);
    // The second delay is up to two seconds, so one more second is not enough.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(open).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(open).toHaveBeenCalledTimes(3);

    controller.abort();
  });

  it("never waits less than the ceiling after a rate limit", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(RealtimeStream.backoff(0, true)).toBe(30_000);
    expect(RealtimeStream.backoff(0, false)).toBe(0);
  });

  it("delivers frames and stops when aborted", async () => {
    const { controller, frames, done } = start(() => ending([FRAME_A]));

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await done;

    expect(frames[0]).toEqual(FRAME_A);
  });
});
