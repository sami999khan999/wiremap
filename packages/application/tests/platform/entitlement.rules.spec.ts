import { ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { EntitlementRules } from "../../src/platform/entitlement.rules.js";

describe("EntitlementRules", () => {
  it("admits a tenant key and refuses core, platform and unknown keys", () => {
    expect(EntitlementRules.assertMaskable("member.invite")).toBe("member.invite");

    for (const key of ["core.activity.write", "platform.status.read", "task.archive"]) {
      expect(() => EntitlementRules.assertMaskable(key)).toThrow(ValidationError);
    }
  });

  // A plan without the role list would entitle an invite form with an empty picker.
  it("stores a plan closed over requires", () => {
    expect(EntitlementRules.closePlan(["member.invite"])).toEqual([
      "member.invite",
      "member.read",
      "rbac.role.read",
    ]);
  });

  // `RV.13`: a remove takes what depends on it, an add brings what it needs.
  it("closes an adjustment in the direction of its effect", () => {
    expect(EntitlementRules.closeAdjustment("member.invite", "add")).toContain("rbac.role.read");

    const removed = EntitlementRules.closeAdjustment("rbac.role.read", "remove");
    expect(removed).toContain("member.invite");
    expect(removed).not.toContain("member.read");
  });

  it("switches only a module the mask reaches", () => {
    expect(EntitlementRules.assertSwitchable("doc")).toBe("doc");
    for (const module of ["core", "platform", "finance"]) {
      expect(() => EntitlementRules.assertSwitchable(module)).toThrow(ValidationError);
    }
    expect(EntitlementRules.switchable()).not.toContain("core");
    expect(EntitlementRules.switchable()).not.toContain("platform");
  });

  it("wants a plan key an operator can type and a reason somebody wrote", () => {
    expect(EntitlementRules.assertPlanKey("team-2026")).toBe("team-2026");
    expect(() => EntitlementRules.assertPlanKey("Team Plan")).toThrow(ValidationError);
    expect(EntitlementRules.assertReason("  trial for Acme  ")).toBe("trial for Acme");
    expect(() => EntitlementRules.assertReason("   ")).toThrow(ValidationError);
  });

  it("offers every maskable key and nothing outside the mask", () => {
    const keys = EntitlementRules.maskableKeys();
    expect(keys).toContain("apikey.read");
    expect(keys.some((key) => key.startsWith("core.") || key.startsWith("platform."))).toBe(false);
  });
});
