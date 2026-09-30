import { DomainEvents, Identifiers } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { describe, expect, it } from "vitest";
import type { RelayedActivity } from "../../src/port/index.js";
import { RelayedActivityStore } from "../../src/port/index.js";
import { ActivityRelaySubscriber } from "../../src/subscriber/index.js";

class Store extends RelayedActivityStore {
  public readonly saved: RelayedActivity[] = [];

  public override save(entry: RelayedActivity): Promise<void> {
    this.saved.push(entry);
    return Promise.resolve();
  }
}

const ORG = Identifiers.organizationId.parse(Uuid.v7());
const ACTOR = Identifiers.userId.parse(Uuid.v7());
const AT = new Date("2026-09-24T10:00:00.000Z");

// `24.2a`: the row a catalog transaction published for a tenant on another node.
describe("ActivityRelaySubscriber", () => {
  it("writes the row with the event's time and the entry's own id", async () => {
    const store = new Store();
    const entryId = Uuid.v7();
    const event = DomainEvents.parse({
      id: Uuid.v7(),
      organizationId: ORG,
      name: "activity.recorded",
      actorId: ACTOR,
      occurredAt: AT,
      payload: { entryId, action: "member.invited", payload: { email: "a@example.test" } },
    });

    await new ActivityRelaySubscriber(store).handle(event);

    expect(store.saved).toEqual([
      {
        id: entryId,
        organizationId: ORG,
        actorId: ACTOR,
        action: "member.invited",
        payload: { email: "a@example.test" },
        occurredAt: AT,
      },
    ]);
  });

  it("listens for the one event it writes", () => {
    expect(new ActivityRelaySubscriber(new Store()).events).toEqual(["activity.recorded"]);
  });
});
