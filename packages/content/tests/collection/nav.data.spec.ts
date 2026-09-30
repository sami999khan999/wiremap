import { ICON_NAMES } from "@loadbearing/asset";
import { GATES } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { navItems } from "../../src/collection/nav/nav.data.js";
import { NavContract } from "../../src/collection/nav/nav.schema.js";
import { nav } from "../../src/message/en/nav.js";

describe("navItems", () => {
  it("parses against its own contract", () => {
    expect(() => NavContract.collection.parse(navItems)).not.toThrow();
  });

  // Content may name a module; the registry decides what gates it. A menu entry naming
  // a module that does not exist is what this catches.
  it("names only modules the registry knows", () => {
    for (const item of navItems) {
      expect(Object.hasOwn(GATES, item.module)).toBe(true);
    }
  });

  it("never carries a permission of its own", () => {
    // A `permission` field here would make a content edit a privilege escalation —
    // the kind of vulnerability found by accident, years later.
    for (const item of navItems) {
      expect(Object.hasOwn(item, "permission")).toBe(false);
    }
  });

  it("points every label at copy that exists in the nav namespace", () => {
    for (const item of navItems) {
      expect(Object.hasOwn(nav, item.labelKey)).toBe(true);
    }
  });

  it("names only icons that are in the sprite", () => {
    for (const item of navItems) {
      expect(ICON_NAMES as readonly string[]).toContain(item.icon);
    }
  });

  it("gives every entry a distinct order", () => {
    const orders = navItems.map((item) => item.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("rejects a malformed record at parse time", () => {
    expect(() => NavContract.collection.parse([{ module: "rbac", order: "first" }])).toThrow();
  });
});
