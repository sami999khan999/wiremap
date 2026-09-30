import { describe, expect, it } from "vitest";
import type { CapabilitySetDto } from "../../src/capability/capability-set.js";
import { EntitlementMask } from "../../src/capability/entitlement-mask.js";
import { type PermissionKey, PermissionRegistry } from "../../src/registry/permission-registry.js";

const nothing = { added: [], removed: [], disabledModules: [] } as const;

describe("EntitlementMask", () => {
  it("entitles what the plan lists and nothing else", () => {
    const mask = EntitlementMask.from({ ...nothing, plan: ["member.read"] });

    expect(mask.isEntitled("member.read")).toBe(true);
    expect(mask.isEntitled("apikey.read")).toBe(false);
  });

  // A trial is an expiring add; a removal is an explicit "not this org", and it wins.
  it("lets an add widen the plan and a remove beat both", () => {
    const mask = EntitlementMask.from({
      plan: ["member.read"],
      added: ["apikey.read", "member.invite"],
      removed: ["member.read", "member.invite"],
      disabledModules: [],
    });

    expect(mask.isEntitled("apikey.read")).toBe(true);
    expect(mask.isEntitled("member.read")).toBe(false);
    expect(mask.isEntitled("member.invite")).toBe(false);
  });

  it("removes every key of a disabled module, add or not", () => {
    const mask = EntitlementMask.from({
      plan: "all",
      added: ["messaging.message.send"],
      removed: [],
      disabledModules: ["messaging"],
    });

    for (const key of PermissionRegistry.instance.byModule("messaging")) {
      expect(mask.isEntitled(key)).toBe(false);
    }
    expect(mask.isEntitled("member.read")).toBe(true);
  });

  it("never masks a core key or a platform key", () => {
    const mask = EntitlementMask.from({
      plan: [],
      added: [],
      removed: ["core.activity.write", "platform.status.read"],
      disabledModules: ["core", "platform"],
    });

    expect(mask.isEntitled("core.activity.write")).toBe(true);
    expect(mask.isEntitled("platform.status.read")).toBe(true);
  });

  // `unlimited` is a property, not a list of rows. A key a later deploy adds is entitled
  // the day it ships, with no reseed — here, one this catalog has never seen.
  it("resolves all at the question, including a key declared after it was built", () => {
    const mask = EntitlementMask.from({ ...nothing, plan: "all" });

    expect(mask.isEntitled("task.archive" as PermissionKey)).toBe(true);
    expect(mask.keys()).toEqual(PermissionRegistry.instance.all());
  });

  it("narrows grants, and leaves denies, the wildcard and the platform axis alone", () => {
    const dto: CapabilitySetDto = {
      wildcard: false,
      org: { grants: ["member.read", "apikey.read"], denies: ["member.invite"] },
      goals: { g1: { grants: ["apikey.read"], denies: ["apikey.read"] } },
      platform: { grants: ["platform.status.read"], denies: [] },
    };

    const narrowed = EntitlementMask.from({ ...nothing, plan: ["member.read"] }).narrow(dto);

    expect(narrowed.org).toEqual({ grants: ["member.read"], denies: ["member.invite"] });
    expect(narrowed.goals.g1).toEqual({ grants: [], denies: ["apikey.read"] });
    expect(narrowed.platform).toEqual(dto.platform);
    expect(narrowed.wildcard).toBe(false);
  });
});
