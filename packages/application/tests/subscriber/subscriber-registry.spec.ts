import type { DomainEvent, DomainEventName } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { EventSubscriber } from "../../src/subscriber/event.subscriber.js";
import { SubscriberRegistry } from "../../src/subscriber/subscriber-registry.js";

class Stub extends EventSubscriber {
  public readonly handled: DomainEvent[] = [];

  public constructor(
    public readonly name: string,
    public readonly events: readonly DomainEventName[],
  ) {
    super();
  }

  public handle(event: DomainEvent): Promise<void> {
    this.handled.push(event);
    return Promise.resolve();
  }
}

describe("SubscriberRegistry", () => {
  it("maps each event to every subscriber that listens for it", () => {
    const registry = new SubscriberRegistry([
      new Stub("member-realtime", ["member.invited", "member.joined"]),
      new Stub("member-audit", ["member.joined"]),
    ]);

    expect(registry.subscriptions().get("member.joined")).toEqual([
      "member-realtime",
      "member-audit",
    ]);
    expect(registry.subscriptions().get("member.invited")).toEqual(["member-realtime"]);
  });

  // The name is half of every job id, so two subscribers sharing one would deduplicate
  // against each other and one of them would silently never run.
  it("refuses two subscribers with the same name, at construction", () => {
    expect(
      () => new SubscriberRegistry([new Stub("a", []), new Stub("a", ["member.joined"])]),
    ).toThrow("Duplicate subscriber name: a");
  });

  // A wiring mistake must be a startup crash rather than an event dropped at 3am.
  it("refuses an event the catalog does not declare, at construction", () => {
    expect(
      () => new SubscriberRegistry([new Stub("a", ["member.left" as DomainEventName])]),
    ).toThrow("unknown event: member.left");
  });

  it("throws rather than returning undefined for a subscriber it does not hold", () => {
    expect(() => new SubscriberRegistry([]).get("gone")).toThrow("Unknown subscriber: gone");
  });
});
