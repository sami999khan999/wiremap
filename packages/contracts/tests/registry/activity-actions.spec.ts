import { describe, expect, it } from "vitest";
import { ACTIVITY_ACTIONS } from "../../src/catalog/index.js";
import { ActivityActions } from "../../src/registry/activity-actions.js";

describe("ActivityActions", () => {
  it("lists every catalog entry with its label", () => {
    const all = ActivityActions.all();

    expect(all).toHaveLength(Object.keys(ACTIVITY_ACTIONS).length);
    expect(all.every((entry) => entry.label.length > 0)).toBe(true);
  });

  it("knows an action that is in the catalog", () => {
    expect(ActivityActions.isKnown("role.created")).toBe(true);
    expect(ActivityActions.isKnown("member.deactivated")).toBe(true);
  });

  it("does not know one that is not", () => {
    expect(ActivityActions.isKnown("role.invented")).toBe(false);
  });

  // `Object.hasOwn`, not a bare index: an unguarded lookup resolves up the prototype
  // chain to a function, which would let `toString` through as an action.
  it("does not know a prototype member", () => {
    expect(ActivityActions.isKnown("toString")).toBe(false);
    expect(ActivityActions.isKnown("constructor")).toBe(false);
  });

  // Past tense, every one of them. A present-tense entry is a permission key that
  // wandered into the wrong catalog, which is the failure the vocabulary rule names.
  it("names every action in the past tense", () => {
    const present = ["create", "update", "delete", "revoke", "invite", "change", "request"];

    for (const { action } of ActivityActions.all()) {
      const verb = action.split(".").at(-1) ?? "";
      expect(present, action).not.toContain(verb);
    }
  });

  // The projection policy is keyed on the action, so two fragments merging over one
  // key would silently give one of them the other's label and one policy row.
  it("has no duplicate keys across the fragments", () => {
    const keys = ActivityActions.all().map((entry) => entry.action);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
