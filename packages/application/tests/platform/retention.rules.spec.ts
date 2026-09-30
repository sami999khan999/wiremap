import { describe, expect, it } from "vitest";
import { RetentionRules } from "../../src/platform/retention.rules.js";
import type { RetentionPolicyRecord } from "../../src/platform/retention-policy.repository.js";

const row = (overrides: Partial<RetentionPolicyRecord> = {}): RetentionPolicyRecord => ({
  store: "postgres",
  tableName: "activity_log",
  hotMonths: 13,
  coldMonths: 24,
  coldMode: "archive",
  ...overrides,
});

// Not composed from a row: an export is a copy of a tenant's data sitting in a bucket,
// and seven days is how long that is a download rather than a liability.
const EXPORT_RULE = { prefix: "export/", expireAfterDays: 7 };

describe("RetentionRules.lifecycleFor", () => {
  it("writes one rule per postgres table with a cold window", () => {
    expect(RetentionRules.lifecycleFor([row()])).toEqual([
      { prefix: "cold/activity_log/", expireAfterDays: 731 },
      EXPORT_RULE,
    ]);
  });

  // Null is "never expires", which is a different statement from zero — and a rule with
  // no expiry is not a rule S3 can express, so the table simply gets none.
  it("writes no rule for a table with no cold window", () => {
    expect(RetentionRules.lifecycleFor([row({ coldMonths: null })])).toEqual([EXPORT_RULE]);
  });

  it("writes a rule that expires immediately for zero", () => {
    expect(RetentionRules.lifecycleFor([row({ coldMonths: 0 })])).toEqual([
      { prefix: "cold/activity_log/", expireAfterDays: 0 },
      EXPORT_RULE,
    ]);
  });

  // The ClickHouse row is a TTL, not a prefix. A rule for it would expire objects under
  // `cold/activity_events/`, which is a prefix nothing writes to.
  it("ignores the clickhouse row", () => {
    expect(
      RetentionRules.lifecycleFor([row({ store: "clickhouse", tableName: "activity_events" })]),
    ).toEqual([EXPORT_RULE]);
  });

  // Sorted, and it is not cosmetic: the daily job compares what the rows compose to
  // against what the bucket holds, and an unstable order is a rewrite every run.
  it("sorts by prefix, so two runs over the same rows compare equal", () => {
    const one = RetentionRules.lifecycleFor([
      row({ tableName: "notifications" }),
      row({ tableName: "activity_log" }),
    ]);
    const other = RetentionRules.lifecycleFor([
      row({ tableName: "activity_log" }),
      row({ tableName: "notifications" }),
    ]);

    expect(one.map((rule) => rule.prefix)).toEqual([
      "cold/activity_log/",
      "cold/notifications/",
      "export/",
    ]);
    expect(RetentionRules.lifecycleMatches(one, other)).toBe(true);
  });
});

describe("RetentionRules.clickhouseTtlFor — per-action clauses", () => {
  const COLUMN = "toDateTime(occurred_at)";

  // **No `DELETE`**, and it is not a style choice: ClickHouse accepts the keyword and
  // echoes it back stripped, so emitting it makes the daily comparison differ forever.
  it("emits no DELETE keyword, because the store does not echo one", () => {
    expect(
      RetentionRules.clickhouseTtlFor(60, [{ action: "role.created", months: 120 }]),
    ).not.toContain("DELETE");
  });

  it("composes one clause per row plus a guarded default", () => {
    expect(RetentionRules.clickhouseTtlFor(12, [{ action: "role.created", months: 120 }])).toBe(
      [
        `${COLUMN} + toIntervalMonth(120) WHERE action = 'role.created'`,
        `${COLUMN} + toIntervalMonth(12) WHERE action NOT IN ('role.created')`,
      ].join(", "),
    );
  });

  it("names every per-action row in the default clause", () => {
    const expression = RetentionRules.clickhouseTtlFor(12, [
      { action: "role.created", months: 120 },
      { action: "ai.document.searched", months: 3 },
      { action: "member.joined", months: 24 },
    ]);

    expect(expression).toContain(
      "WHERE action NOT IN ('ai.document.searched', 'member.joined', 'role.created')",
    );
    expect(expression.split(", toDateTime")).toHaveLength(4);
  });

  // Sorted, and it is not cosmetic: the daily job compares the composed string against
  // what the store holds, and an unstable order rewrites a years-deep table every night.
  it("sorts by action, so two runs over the same rows compose the same string", () => {
    const one = RetentionRules.clickhouseTtlFor(12, [
      { action: "role.created", months: 120 },
      { action: "member.joined", months: 24 },
    ]);
    const other = RetentionRules.clickhouseTtlFor(12, [
      { action: "member.joined", months: 24 },
      { action: "role.created", months: 120 },
    ]);

    expect(one).toBe(other);
  });

  // The whole reason the default clause is guarded. Proved against a live ClickHouse in
  // `tests/smoke/analytics.smoke.spec.ts`; here it is the shape that carries the proof.
  it("guards the default clause, so a longer per-action TTL is not deleted by it", () => {
    const expression = RetentionRules.clickhouseTtlFor(12, [
      { action: "role.created", months: 120 },
    ]);
    const clauses = expression.split(", ");

    expect(clauses.at(-1)).toContain("NOT IN ('role.created')");
    expect(clauses.every((clause) => clause.includes("WHERE"))).toBe(true);
  });
});

describe("RetentionRules.daysFor", () => {
  // Rounded up. Rounding down expires an object inside the window an operator asked
  // for, which is the direction that loses data.
  it("rounds up, never down", () => {
    expect(RetentionRules.daysFor(1)).toBe(31);
    expect(RetentionRules.daysFor(12)).toBe(366);
    expect(RetentionRules.daysFor(24)).toBe(731);
  });

  it("answers zero for zero", () => {
    expect(RetentionRules.daysFor(0)).toBe(0);
  });
});

describe("RetentionRules.clickhouseTtlFor", () => {
  // **The form ClickHouse reads back**, measured against a live one rather than guessed:
  // the readable form would differ every run and rewrite every part of the table.
  it("emits the normalised form, not `INTERVAL n MONTH`", () => {
    expect(RetentionRules.clickhouseTtlFor(60)).toBe(
      "toDateTime(occurred_at) + toIntervalMonth(60)",
    );
    expect(RetentionRules.clickhouseTtlFor(60)).not.toContain("INTERVAL");
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
});

// `25.3`. A colder class for every cold prefix, never for an export, and never one that
// would land after the object is already gone.
describe("RetentionRules.lifecycleFor — a cold tier", () => {
  const TIER = { storageClass: "COLD", afterDays: 30 };

  it("moves every cold prefix to the tier and leaves the export rule alone", () => {
    expect(
      RetentionRules.lifecycleFor([row(), row({ tableName: "messages", coldMonths: 12 })], TIER),
    ).toEqual([
      { prefix: "cold/activity_log/", expireAfterDays: 731, transition: TIER },
      { prefix: "cold/messages/", expireAfterDays: 366, transition: TIER },
      EXPORT_RULE,
    ]);
  });

  // S3 rejects a transition that is not earlier than the expiry, and the whole
  // configuration with it — one short window would take every other rule down.
  it("writes no transition that would land on or after the expiry", () => {
    expect(
      RetentionRules.lifecycleFor([row({ coldMonths: 1 })], { ...TIER, afterDays: 31 }),
    ).toEqual([{ prefix: "cold/activity_log/", expireAfterDays: 31 }, EXPORT_RULE]);
  });

  it("is today's configuration exactly when there is no tier", () => {
    expect(RetentionRules.lifecycleFor([row()], null)).toEqual(
      RetentionRules.lifecycleFor([row()]),
    );
  });

  // A bucket that lost its transition by hand is drift, or the nightly job never puts
  // it back — the comparison has to see the class, not only the expiry.
  it("reads a missing transition as drift", () => {
    const expected = RetentionRules.lifecycleFor([row()], TIER);
    const stripped = expected.map(({ prefix, expireAfterDays }) => ({ prefix, expireAfterDays }));

    expect(RetentionRules.lifecycleMatches(expected, stripped)).toBe(false);
    expect(RetentionRules.describe(expected[0] ?? EXPORT_RULE)).toBe(
      "cold/activity_log/=731>COLD@30",
    );
  });
});
