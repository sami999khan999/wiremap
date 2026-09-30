import { describe, expect, it } from "vitest";
import { RealtimeChannels } from "../../src/primitive/realtime-channel.js";

const ORG = "018f8c00-0000-7000-8000-000000000010";
const USER = "018f8c00-0000-7000-8000-000000000011";

describe("RealtimeChannels", () => {
  // Tenant-leading, always: sharded pub/sub, Redis Streams and a broker partitioner can
  // all key on a prefix, and none of them can key on something buried in the middle.
  it("leads every channel with the organization", () => {
    expect(RealtimeChannels.user(ORG, USER)).toBe(`org:${ORG}:user:${USER}`);
    expect(RealtimeChannels.user(ORG, USER).startsWith(`org:${ORG}:`)).toBe(true);
  });

  it("gives two users in one organization different channels", () => {
    const other = "018f8c00-0000-7000-8000-000000000012";

    expect(RealtimeChannels.user(ORG, USER)).not.toBe(RealtimeChannels.user(ORG, other));
  });
});
