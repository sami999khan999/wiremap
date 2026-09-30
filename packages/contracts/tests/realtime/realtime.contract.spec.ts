import { describe, expect, it } from "vitest";
import { RealtimeContract } from "../../src/realtime/realtime.contract.js";

const frame = (payload: unknown) => ({
  kind: "event",
  id: "018f8c00-0000-7000-8000-0000000000f1",
  name: "message.sent",
  at: "2026-09-26T00:00:00Z",
  payload,
});

describe("RealtimeContract.message", () => {
  // A publisher one deploy ahead of this reader: a key it does not know is dropped, not
  // a frame that fails to parse and is lost.
  it("parses a payload carrying keys it does not know, and strips them", () => {
    const parsed = RealtimeContract.message.parse(
      frame({ conversationId: "018f8c00-0000-7000-8000-0000000000c1", extra: 1 }),
    );

    expect(parsed.kind === "event" && parsed.payload).toEqual({
      conversationId: "018f8c00-0000-7000-8000-0000000000c1",
    });
  });

  it("parses an empty payload, which older publishers send", () => {
    expect(RealtimeContract.message.safeParse(frame({})).success).toBe(true);
  });

  it("refuses an id that is not one", () => {
    expect(RealtimeContract.message.safeParse(frame({ messageId: "nope" })).success).toBe(false);
  });
});
