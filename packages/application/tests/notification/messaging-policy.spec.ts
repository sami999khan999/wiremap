import type { DomainEvent } from "@loadbearing/contracts";
import { Identifiers } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { NotificationPolicy } from "../../src/notification/notification.policy.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const CONVERSATION = Identifiers.conversationId.parse("018f8c00-0000-7000-8000-0000000000c1");
const MESSAGE = Identifiers.messageId.parse("018f8c00-0000-7000-8000-0000000000d1");

const sent = (conversationKind: "direct" | "channel"): DomainEvent =>
  ({
    id: "018f8c00-0000-7000-8000-0000000000f1",
    name: "message.sent",
    organizationId: ORG,
    actorId: ACTOR,
    occurredAt: new Date("2026-09-13T12:00:00Z"),
    payload: {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      createdAt: new Date(),
      conversationKind,
    },
  }) as DomainEvent;

describe("the messaging notification policy", () => {
  // A busy channel notifying every member per message is the write amplification
  // `data-and-scale.md` §6 exists to warn about. A mention feature is what changes it.
  it("produces a notification for a direct message and none for a channel", () => {
    expect(NotificationPolicy.applies(sent("direct"))).toBe(true);
    expect(NotificationPolicy.applies(sent("channel"))).toBe(false);
  });

  // The subject is what makes ten messages one bell item: the second delivery finds an
  // unread row about the same conversation and writes nothing.
  it("names the conversation as the subject, so one unread covers a burst", () => {
    expect(NotificationPolicy.subjectOf(sent("direct"))).toBe(CONVERSATION);
  });

  it("names no subject for the membership rows, which dedupe on the event alone", () => {
    const joined = {
      id: "018f8c00-0000-7000-8000-0000000000f2",
      name: "member.joined",
      organizationId: ORG,
      actorId: ACTOR,
      occurredAt: new Date(),
      payload: { userId: ACTOR, roleId: ACTOR },
    } as unknown as DomainEvent;

    expect(NotificationPolicy.subjectOf(joined)).toBeNull();
    expect(NotificationPolicy.applies(joined)).toBe(true);
  });

  it("links a message notification at the conversation it is about", () => {
    expect(NotificationPolicy.rowFor("message.sent")?.link(sent("direct"))).toBe(
      `/messages/${CONVERSATION}`,
    );
  });

  // In-app at once, email once a day: a DM is worth interrupting a screen for and almost
  // never worth interrupting an inbox for.
  it("defaults to immediate in-app and a daily email", () => {
    expect(NotificationPolicy.defaultMode("message.sent", "in_app")).toBe("immediate");
    expect(NotificationPolicy.defaultMode("message.sent", "email")).toBe("digest");
  });

  it("subscribes to it, because the subscriber's events are the policy's keys", () => {
    expect(NotificationPolicy.events()).toContain("message.sent");
  });
});
