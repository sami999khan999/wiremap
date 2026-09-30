import type { ColdTier, LifecycleRule } from "../port/index.js";
import type { RetentionPolicyRecord } from "./retention-policy.repository.js";

// The average Gregorian month. S3 counts days and the policy is written in months, so
// one has to give — and the screen says "about", which is the honest word.
const DAYS_PER_MONTH = 30.44;

// One rule per table, never per tenant-month: lifecycle rules match a prefix and are
// capped at 1,000 per bucket, so a shorter per-tenant window is the worker's job.
const COLD_PREFIX = "cold/";

// The only rule not composed from a row. An export is a copy of a tenant's data in a
// bucket, and seven days is how long that is a download rather than a liability.
const EXPORT_PREFIX = "export/";
const EXPORT_DAYS = 7;

// Pure. Every number the screen shows and every rule the bucket receives is composed
// here, so the screen and the worker cannot drift.
export class RetentionRules {
  private constructor() {}

  // Sorted by prefix, so two runs over the same rows compare equal — otherwise the daily
  // job rewrites the bucket every time the row order changes.
  // ──
  // `tier` moves every cold prefix to a colder class, never an export: a download that
  // must be restored first is not a download. See infrastructure's storage-policy.md.
  public static lifecycleFor(
    rows: readonly RetentionPolicyRecord[],
    tier: ColdTier | null = null,
  ): readonly LifecycleRule[] {
    const cold = rows
      .filter((row) => row.store === "postgres" && row.coldMonths !== null)
      .map((row) => {
        const rule = {
          prefix: `${COLD_PREFIX}${row.tableName}/`,
          expireAfterDays: RetentionRules.daysFor(row.coldMonths ?? 0),
        };
        // Only a transition that lands before the expiry: one after it moves nothing,
        // and S3 rejects a rule whose transition is not earlier than its expiration.
        return tier && tier.afterDays < rule.expireAfterDays ? { ...rule, transition: tier } : rule;
      });

    return [...cold, { prefix: EXPORT_PREFIX, expireAfterDays: EXPORT_DAYS }].sort((left, right) =>
      left.prefix.localeCompare(right.prefix),
    );
  }

  // Rounded up, never down: rounding down expires an object inside the window an
  // operator asked for, which is the direction that loses data.
  public static daysFor(months: number): number {
    return Math.ceil(months * DAYS_PER_MONTH);
  }

  // Whether the bucket already holds what the rows describe. Both sides are sorted, so
  // comparing the serialised form is what makes "apply on difference" one expression.
  public static lifecycleMatches(
    expected: readonly LifecycleRule[],
    actual: readonly LifecycleRule[],
  ): boolean {
    return RetentionRules.serialise(expected) === RetentionRules.serialise(actual);
  }

  // One rule as the screen shows it and the comparison reads it, so a bucket that lost
  // its transition is drift rather than a match. `cold/messages/=365>COLD@30`.
  public static describe(rule: LifecycleRule): string {
    const base = `${rule.prefix}=${rule.expireAfterDays}`;
    if (!rule.transition) return base;
    return `${base}>${rule.transition.storageClass}@${rule.transition.afterDays}`;
  }

  private static serialise(rules: readonly LifecycleRule[]): string {
    return [...rules]
      .sort((left, right) => left.prefix.localeCompare(right.prefix))
      .map((rule) => RetentionRules.describe(rule))
      .join("|");
  }
}
