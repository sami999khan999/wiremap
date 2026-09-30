import { describe, expect, it } from "vitest";
import { FlagRegistry } from "../../src/registry/flag-registry.js";

const flags = FlagRegistry.instance;

describe("FlagRegistry", () => {
  it("knows nothing inherited", () => {
    expect(flags.isKnown("example.rollout")).toBe(false);
    expect(flags.isKnown("constructor")).toBe(false);
  });

  // A database row can name a flag the code deleted: the platform list shows it as orphaned.
  it("answers undefined for an unknown flag rather than throwing", () => {
    expect(flags.meta("retired.flag")).toBeUndefined();
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

  // Lite has no widgets, and a widget naming a flag is the only thing that sends it to a browser.
  it("sends no flag to the browser", () => {
    for (const key of flags.all()) expect(flags.isClientGating(key)).toBe(false);
    expect(flags.clientGating()).toEqual([]);
  });
});
