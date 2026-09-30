import { describe, expect, it } from "vitest";
import { FlagRegistry } from "../../src/registry/flag-registry.js";
import { WidgetRegistry } from "../../src/registry/widget-registry.js";

const flags = FlagRegistry.instance;

describe("FlagRegistry", () => {
  it("knows a declared flag and nothing inherited", () => {
    expect(flags.isKnown("widget.dismissal")).toBe(true);
    expect(flags.isKnown("widget.nonexistent")).toBe(false);
    expect(flags.isKnown("constructor")).toBe(false);
  });

  // A database row can name a flag the code deleted: the platform list shows it as orphaned.
  it("answers undefined for an unknown flag rather than throwing", () => {
    expect(flags.meta("retired.flag")).toBeUndefined();
    expect(flags.meta("widget.dismissal")?.owner).toBe("sami");
  });

  it("gives every flag an owner, a description and a real calendar date", () => {
    for (const key of flags.all()) {
      const meta = flags.meta(key);

      expect(meta?.owner).not.toBe("");
      expect(meta?.description).not.toBe("");
      expect(meta?.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${meta?.expiresOn}T00:00:00Z`).toISOString().slice(0, 10)).toBe(
        meta?.expiresOn,
      );
    }
  });

  // Derived, never declared: exactly the flags some widget names reach the browser.
  it("treats a flag as client-gating exactly when a widget names it", () => {
    const named = new Set(
      WidgetRegistry.instance.all().flatMap((key) => {
        const flag = WidgetRegistry.instance.meta(key)?.flag;
        return flag ? [flag] : [];
      }),
    );

    for (const key of flags.all()) {
      expect(flags.isClientGating(key)).toBe(named.has(key));
    }
    expect(flags.clientGating()).toEqual(flags.all().filter((key) => named.has(key)));
  });

  // `AX9.6`: the hidden-card tray names it, and that alone is what makes it client-gating.
  it("makes widget.dismissal client-gating once a widget names it", () => {
    expect(flags.isClientGating("widget.dismissal")).toBe(true);
    expect(flags.clientGating()).toEqual(["widget.dismissal"]);
  });
});
