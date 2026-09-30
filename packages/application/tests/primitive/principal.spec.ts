import { Identifiers } from "@loadbearing/contracts";
import { CapabilitySet } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const readOnly = (): CapabilitySet =>
  CapabilitySet.from({
    wildcard: false,
    org: { grants: ["rbac.role.read"], denies: [] },
    goals: {},
  });

describe("Principal", () => {
  it("defaults to the user kind", () => {
    expect(new Principal(ORG, USER, CapabilitySet.empty()).kind).toBe("user");
  });

  it("delegates can() to the capability set", () => {
    const actor = new Principal(ORG, USER, readOnly());

    expect(actor.can("rbac.role.read")).toBe(true);
    expect(actor.can("rbac.role.manage")).toBe(false);
  });

  it("marks an API key principal without widening it", () => {
    const actor = Principal.apiKey(ORG, USER, readOnly());

    expect(actor.kind).toBe("api_key");
    expect(actor.userId).toBe(USER);
    expect(actor.can("rbac.role.manage")).toBe(false);
  });

  // The tempting shortcut is a wildcard principal for the worker. This is the
  // assertion that says the shortcut was not taken.
  it("gives a system principal only what it was handed", () => {
    const actor = Principal.system(ORG, USER, CapabilitySet.empty());

    expect(actor.kind).toBe("system");
    expect(actor.can("rbac.role.read")).toBe(false);
  });
});
