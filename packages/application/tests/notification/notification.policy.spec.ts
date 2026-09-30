import { DomainEvents } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { NotificationPolicy } from "../../src/notification/notification.policy.js";
import { NotificationSubscriber } from "../../src/notification/notification.subscriber.js";

describe("NotificationPolicy", () => {
  // A row for an event no publisher emits is a rule nobody will ever notice is wrong.
  it("has a row only for events the catalog declares", () => {
    for (const name of NotificationPolicy.events()) {
      expect(DomainEvents.isKnown(name), name).toBe(true);
    }
  });

  it("gives every row a kind, a category and a default per channel", () => {
    for (const name of NotificationPolicy.events()) {
      const row = NotificationPolicy.rowFor(name);

      expect(row?.kind, name).toBeTruthy();
      expect(row?.category, name).toBeTruthy();
      expect(row?.defaultMode.in_app, name).toBeTruthy();
      expect(row?.defaultMode.email, name).toBeTruthy();
    }
  });

  it("answers `off` for an event it has no row for, rather than throwing", () => {
    expect(NotificationPolicy.defaultMode("member.invited", "email")).toBe("off");
    expect(NotificationPolicy.rowFor("member.invited")?.recipients.kind).toBe("none");
  });

  // The subscriber's `events` list *is* the policy's keys, so a row added there is
  // delivered with no second edit — and this is what says so.
  it("is what the subscriber subscribes to, with no second list", () => {
    const subscriber = new NotificationSubscriber({ execute: () => Promise.resolve() } as never);

    expect([...subscriber.events]).toEqual([...NotificationPolicy.events()]);
  });
});
