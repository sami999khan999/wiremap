import { describe, expect, expectTypeOf, it } from "vitest";
import { CapabilitySet } from "../../src/capability/capability-set.js";
import { GATES } from "../../src/gate/index.js";
import type { FlagKey } from "../../src/registry/flag-registry.js";
import { type PermissionKey, PermissionRegistry } from "../../src/registry/permission-registry.js";
import {
  type InlineWidgetKey,
  type WidgetFacts,
  WidgetRegistry,
  ZONES,
  type ZoneWidgetKey,
} from "../../src/registry/widget-registry.js";

const widgets = WidgetRegistry.instance;

function holding(...grants: readonly PermissionKey[]): CapabilitySet {
  return CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} });
}

function facts(overrides: Partial<WidgetFacts> = {}): WidgetFacts {
  return {
    capabilities: holding("member.read", "notification.inbox.read"),
    flags: new Set<FlagKey>(),
    hiddenByAdmin: new Set(),
    hiddenByUser: new Set(),
    ...overrides,
  };
}

describe("WidgetRegistry — resolution", () => {
  it("shows a widget nothing hides", () => {
    expect(widgets.visibilityOf("member.count", facts())).toBe("visible");
  });

  it("answers unregistered for a key the code does not declare", () => {
    expect(widgets.visibilityOf("finance.outstanding", facts())).toBe("unregistered");
    expect(widgets.visibilityOf("constructor", facts())).toBe("unregistered");
  });

  it("denies a widget whose permission the principal lacks", () => {
    expect(widgets.visibilityOf("member.count", facts({ capabilities: holding() }))).toBe("denied");
  });

  it("hides a dismissible widget an admin hid, and one the user hid", () => {
    const hidden = new Set(["member.count"]);

    expect(widgets.visibilityOf("member.count", facts({ hiddenByAdmin: hidden }))).toBe(
      "hidden-by-admin",
    );
    expect(widgets.visibilityOf("member.count", facts({ hiddenByUser: hidden }))).toBe(
      "hidden-by-user",
    );
  });

  // Restoring a card the role no longer grants would change nothing, so the preference
  // is the wrong reason to report.
  it("reports the broadest cause when two apply", () => {
    const hidden = new Set(["member.count"]);
    const both = { hiddenByAdmin: hidden, hiddenByUser: hidden };

    expect(widgets.visibilityOf("member.count", facts({ ...both, capabilities: holding() }))).toBe(
      "denied",
    );
    expect(widgets.visibilityOf("member.count", facts(both))).toBe("hidden-by-admin");
  });

  it("ignores both preferences for a required widget", () => {
    const hidden = new Set(["core.module-nav", "notification.bell"]);
    const stale = facts({ hiddenByAdmin: hidden, hiddenByUser: hidden });

    expect(widgets.visibilityOf("core.module-nav", stale)).toBe("visible");
    expect(widgets.visibilityOf("notification.bell", stale)).toBe("visible");
  });

  it("shows an ungated widget to a principal holding nothing", () => {
    expect(widgets.visibilityOf("core.module-nav", facts({ capabilities: holding() }))).toBe(
      "visible",
    );
  });
});

describe("WidgetRegistry — declarations", () => {
  it("sorts each zone by order, and no two widgets in a zone share one", () => {
    for (const zone of ZONES) {
      const orders = widgets.forZone(zone).map((key) => widgets.meta(key)?.order ?? 0);

      expect(orders).toEqual([...orders].sort((a, b) => a - b));
      expect(new Set(orders).size).toBe(orders.length);
    }
    expect(widgets.forZone("dashboard.main")).toEqual([
      "core.module-nav",
      "member.count",
      "core.hidden-widgets",
    ]);
  });

  it("opens every widget key with a module the catalog knows", () => {
    const modules = PermissionRegistry.instance.modules();
    for (const key of widgets.all()) {
      expect(modules).toContain(key.split(".")[0]);
    }
  });

  it("keeps the nav required", () => {
    expect(widgets.meta("core.module-nav")?.policy ?? "required").toBe("required");
    expect(widgets.isDismissible("core.module-nav")).toBe(false);
    expect(widgets.isDismissible("member.count")).toBe(true);
  });

  // Decision 12: hiding a card must never remove the only path in. The join is on the
  // permission's module, not the gate key — the `document` gate asks `ai.embedding.read`.
  it("leaves a nav path to every dismissible widget's module", () => {
    const registry = PermissionRegistry.instance;
    const gated = new Set(
      Object.values(GATES).map((gate) => registry.meta(gate.permission)?.module),
    );

    for (const key of widgets.all()) {
      const permission = widgets.meta(key)?.permission;
      if (!widgets.isDismissible(key) || !permission) continue;

      expect(gated).toContain(registry.meta(permission)?.module);
    }
  });

  it("splits the keys by where they are placed", () => {
    expectTypeOf<ZoneWidgetKey<"dashboard.main">>().toEqualTypeOf<
      "core.module-nav" | "member.count" | "core.hidden-widgets"
    >();
    expectTypeOf<InlineWidgetKey>().toEqualTypeOf<"notification.bell">();
  });
});
