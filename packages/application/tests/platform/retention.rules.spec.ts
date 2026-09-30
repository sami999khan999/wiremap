import { describe, expect, it } from "vitest";
import { RetentionRules } from "../../src/platform/retention.rules.js";

// An export is a copy of a tenant's data sitting in a bucket, and seven days is how long
// that is a download rather than a liability.
const EXPORT_RULE = { prefix: "export/", expireAfterDays: 7 };

describe("RetentionRules.lifecycleFor", () => {
  // Lite composes no per-table rule: it has no retention rows, and a deleted tenant's
  // archive is swept by the worker after its window rather than by the bucket.
  it("writes the export rule and nothing else", () => {
    expect(RetentionRules.lifecycleFor()).toEqual([EXPORT_RULE]);
  });
});

describe("RetentionRules.lifecycleMatches", () => {
  it("ignores order and nothing else", () => {
    const a = { prefix: "cold/a/", expireAfterDays: 30 };
    const b = { prefix: "cold/b/", expireAfterDays: 60 };

    expect(RetentionRules.lifecycleMatches([a, b], [b, a])).toBe(true);
    expect(RetentionRules.lifecycleMatches([a, b], [a])).toBe(false);
    expect(RetentionRules.lifecycleMatches([a], [{ prefix: "cold/a/", expireAfterDays: 31 }])).toBe(
      false,
    );
  });

  it("calls two empty configurations equal, so a fresh bucket converges at once", () => {
    expect(RetentionRules.lifecycleMatches([], [])).toBe(true);
  });

  it("describes a rule the way the drift line prints it", () => {
    expect(RetentionRules.describe(EXPORT_RULE)).toBe("export/=7");
  });
});
