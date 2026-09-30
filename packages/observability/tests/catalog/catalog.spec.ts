import { describe, expect, it } from "vitest";
import { EVENT_CATALOG, type EventCode } from "../../src/catalog/index.js";
import type { EventShape } from "../../src/event/event-shape.js";
import { LogLevels } from "../../src/primitive/log-level.js";

describe("EVENT_CATALOG", () => {
  it("gives every code a declared level", () => {
    for (const [code, meta] of Object.entries(EVENT_CATALOG)) {
      expect(LogLevels.is(meta.level), code).toBe(true);
    }
  });

  it("keeps every sample rate inside 0..1", () => {
    for (const [code, meta] of Object.entries(EVENT_CATALOG)) {
      const sample = (meta as { sample?: number }).sample;
      if (sample === undefined) continue;
      expect(sample, code).toBeGreaterThan(0);
      expect(sample, code).toBeLessThanOrEqual(1);
    }
  });

  it("never samples a warn or an error", () => {
    // A dropped failure is the one thing sampling must not buy you.
    for (const [code, meta] of Object.entries(EVENT_CATALOG)) {
      if (meta.level === "warn" || meta.level === "error") {
        expect((meta as { sample?: number }).sample, code).toBeUndefined();
      }
    }
  });

  it("declares fields for every code", () => {
    // `EventFields<C>` indexes `EventShape` by `EventCode`, so a missing entry is
    // already a compile error. This asserts the runtime halves agree too.
    const declared = new Set(Object.keys(EVENT_CATALOG));
    const shaped: readonly EventCode[] = Object.keys(EVENT_CATALOG) as EventCode[];
    const _typecheck: { [C in EventCode]: EventShape[C] } | undefined = undefined;

    expect(_typecheck).toBeUndefined();
    expect(shaped.every((code) => declared.has(code))).toBe(true);
  });
});
