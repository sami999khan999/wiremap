import type { DomainEvent, RealtimeMessage } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { MemberRealtimeSubscriber } from "../../src/member/member-realtime.subscriber.js";
import type { RealtimePublisher } from "../../src/port/index.js";
import type { RealtimeChannel } from "../../src/primitive/index.js";

const ORG = "018f8c00-0000-7000-8000-000000000010";
const ACTOR = "018f8c00-0000-7000-8000-000000000011";
const TARGET = "018f8c00-0000-7000-8000-000000000012";
const ROLE = "018f8c00-0000-7000-8000-000000000013";

class RecordingRealtime implements RealtimePublisher {
  public readonly frames: { channel: string; message: RealtimeMessage }[] = [];

  public publish(channel: RealtimeChannel, message: RealtimeMessage): Promise<void> {
    this.frames.push({ channel, message });
    return Promise.resolve();
  }
}

const roleChanged = (): DomainEvent =>
  ({
    id: "018f8c00-0000-7000-8000-000000000014",
    organizationId: ORG,
    name: "member.role.changed",
    actorId: ACTOR,
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    payload: { userId: TARGET, roleId: ROLE, previousRoleId: ROLE },
  }) as DomainEvent;

const build = () => {
  const realtime = new RecordingRealtime();
  return { realtime, subscriber: new MemberRealtimeSubscriber(realtime) };
};

describe("MemberRealtimeSubscriber", () => {
  it("frames the actor and the member the change was about, and nobody else", async () => {
    const { realtime, subscriber } = build();

    await subscriber.handle(roleChanged());

    expect(realtime.frames.map((frame) => frame.channel)).toEqual([
      `org:${ORG}:user:${ACTOR}`,
      `org:${ORG}:user:${TARGET}`,
    ]);
  });

  // The invitee has no account yet, so there is no user channel to reach them on.
  it("frames only the actor for an invitation", async () => {
    const { realtime, subscriber } = build();

    await subscriber.handle({ ...roleChanged(), name: "member.invited" } as DomainEvent);

    expect(realtime.frames).toHaveLength(1);
    expect(realtime.frames[0]?.channel).toBe(`org:${ORG}:user:${ACTOR}`);
  });

  it("sends one frame when the actor is the subject", async () => {
    const { realtime, subscriber } = build();

    await subscriber.handle({ ...roleChanged(), actorId: TARGET } as DomainEvent);

    expect(realtime.frames).toHaveLength(1);
  });

  // The frame says a refetch is due; it is not the data. A client reading it as data
  // would be reading a snapshot it has not been authorised for.
  it("carries no member data in the frame", async () => {
    const { realtime, subscriber } = build();

    await subscriber.handle(roleChanged());

    const message = realtime.frames[0]?.message;
    expect(message?.kind).toBe("event");
    expect(message).toMatchObject({ name: "member.changed", payload: {} });
  });

  // Delivery is at-least-once, and this one is idempotent by construction: a second
  // identical frame costs a refetch the client would have done anyway.
  it("is safe to handle twice", async () => {
    const { realtime, subscriber } = build();

    await subscriber.handle(roleChanged());
    await subscriber.handle(roleChanged());

    expect(realtime.frames).toHaveLength(4);
    expect(new Set(realtime.frames.map((f) => f.channel)).size).toBe(2);
  });
});
