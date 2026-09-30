import { describe, expect, it } from "vitest";
import { RealtimeContract } from "../../src/realtime/realtime.contract.js";

const frame = (payload: unknown) => ({
  kind: "event",
  id: "018f8c00-0000-7000-8000-0000000000f1",
  name: "notification.created",
  at: "2026-09-26T00:00:00Z",
  payload,
});

describe("RealtimeContract.message", () => {
  // A publisher one deploy ahead of this reader: a key it does not know is dropped, not
  // a frame that fails to parse and is lost.
  it("parses a payload carrying keys it does not know, and strips them", () => {
    const parsed = RealtimeContract.message.parse(frame({ kind: "member.joined", extra: 1 }));

    expect(parsed.kind === "event" && parsed.payload).toEqual({ kind: "member.joined" });
  });

  it("parses an empty payload, which older publishers send", () => {
    expect(RealtimeContract.message.safeParse(frame({})).success).toBe(true);
  });

  it("refuses a kind that is not a string", () => {
    expect(RealtimeContract.message.safeParse(frame({ kind: 1 })).success).toBe(false);
  });
});
