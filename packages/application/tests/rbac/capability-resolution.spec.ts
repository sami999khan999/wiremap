import { EntitlementMask } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type {
  CapabilityExplanation,
  OverrideRecord,
} from "../../src/rbac/capability.repository.js";
import { CapabilityResolution } from "../../src/rbac/capability-resolution.js";

const UNLIMITED = EntitlementMask.from({
  plan: "all",
  added: [],
  removed: [],
  disabledModules: [],
});

const override = (values: Partial<OverrideRecord>): OverrideRecord => ({
  id: "o",
  permission: "member.read",
  effect: "grant",
  goalId: null,
  authority: "org",
  reason: "r",
  expiresAt: null,
  ...values,
});

const explanation = (values: Partial<CapabilityExplanation>): CapabilityExplanation => ({
  roleGrants: [],
  goalGrants: {},
  overrides: [],
  entitlement: UNLIMITED,
  ...values,
});

describe("CapabilityResolution.fold", () => {
  it("grants what the roles and override grants hold, and nothing else", () => {
    const set = CapabilityResolution.fold(
      explanation({
        roleGrants: ["rbac.role.read"],
        overrides: [override({ permission: "member.read" })],
      }),
    );

    expect(set.can("rbac.role.read")).toBe(true);
    expect(set.can("member.read")).toBe(true);
    expect(set.can("member.invite")).toBe(false);
  });

  it("lets a deny beat a role grant", () => {
    const set = CapabilityResolution.fold(
      explanation({
        roleGrants: ["member.invite"],
        overrides: [override({ permission: "member.invite", effect: "deny" })],
      }),
    );

    expect(set.can("member.invite")).toBe(false);
  });

  // A stale row names a key the catalog dropped; it must grant nothing, not throw.
  it("drops a key the catalog does not know", () => {
    const set = CapabilityResolution.fold(explanation({ roleGrants: ["task.archive"] }));

    expect(set.toJSON().org.grants).toEqual([]);
  });

  it("masks grants the plan leaves out, and keeps every deny", () => {
    const set = CapabilityResolution.fold(
      explanation({
        roleGrants: ["member.read", "apikey.read"],
        overrides: [override({ permission: "member.invite", effect: "deny" })],
        entitlement: EntitlementMask.from({
          plan: ["member.read"],
          added: [],
          removed: [],
          disabledModules: [],
        }),
      }),
    );

    expect(set.toJSON().org).toEqual({ grants: ["member.read"], denies: ["member.invite"] });
  });

  it("places goal grants and goal overrides in their goal", () => {
    const set = CapabilityResolution.fold(
      explanation({
        goalGrants: { g1: ["member.read"] },
        overrides: [override({ permission: "member.read", goalId: "g2" })],
      }),
    );

    expect(Object.keys(set.toJSON().goals).sort()).toEqual(["g1", "g2"]);
  });
});
