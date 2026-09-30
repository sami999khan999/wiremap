import { describe, expect, it } from "vitest";
import { DomainEvents } from "../../src/registry/domain-events.js";

const ORG = "018f8c00-0000-7000-8000-000000000010";
const USER = "018f8c00-0000-7000-8000-000000000011";
const ROLE = "018f8c00-0000-7000-8000-000000000012";
const EVENT = "018f8c00-0000-7000-8000-000000000013";

const joined = {
  id: EVENT,
  organizationId: ORG,
  name: "member.joined",
  actorId: USER,
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  payload: { userId: USER, roleId: ROLE },
};

describe("DomainEvents", () => {
  // English has irregular participles, so the regex below is a heuristic for the rule
  // and not the rule: renaming `message.sent` to fit it would be the tail wagging.
  const IRREGULAR = new Set(["sent", "read", "left", "built", "lost", "won"]);

  it("names every event in the past tense", () => {
    for (const name of DomainEvents.names()) {
      const action = name.split(".").at(-1) ?? "";
      if (IRREGULAR.has(action)) continue;
      expect(action, name).toMatch(/(ed|en)$/);
    }
  });

  it("knows the names it lists and nothing inherited", () => {
    expect(DomainEvents.isKnown("member.joined")).toBe(true);
    expect(DomainEvents.isKnown("member.left")).toBe(false);
    expect(DomainEvents.isKnown("toString")).toBe(false);
  });

  it("parses a whole envelope in one call", () => {
    expect(DomainEvents.envelope.parse(joined)).toMatchObject({ name: "member.joined" });
  });

  // The discriminant is what makes one `parse` enough. Without it a consumer would read
  // `name` first and pick a schema by hand, which is a second place to forget a case.
  it("rejects a payload that belongs to a different event", () => {
    const wrong = { ...joined, name: "member.role.changed" };

    expect(DomainEvents.envelope.safeParse(wrong).success).toBe(false);
  });

  it("rejects an envelope whose name is not in the catalog", () => {
    expect(DomainEvents.envelope.safeParse({ ...joined, name: "member.left" }).success).toBe(false);
  });

  // The invitation token is stored only as a hash so a dump of `invitations` accepts
  // nothing. An event carrying it would hand it straight back.
  it("does not carry the invitation token on `member.invited`", () => {
    expect(Object.keys(DomainEvents.schema("member.invited").shape)).not.toContain("token");
  });
});
