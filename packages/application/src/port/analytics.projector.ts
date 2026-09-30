import type { ActivityAction, OrganizationId } from "../import.js";
import type { ActivityRecord, DailyCount, ProjectionCheckpoint } from "./activity-replay.reader.js";

// The only thing allowed to write to the derived store — anything else makes it a source
// of truth nobody decided to create. See docs/reference/ports.md.
export abstract class AnalyticsProjector {
  // Read from the derived store itself: a checkpoint beside it can disagree with what
  // landed. Per tenant, so a tenant that moves node resumes where it was.
  public abstract checkpoint(organizationId: OrganizationId): Promise<ProjectionCheckpoint>;

  // Idempotent by construction: rows are keyed on the activity id, so a redelivered
  // batch overwrites rather than duplicates. Returns the number written.
  public abstract project(records: readonly ActivityRecord[]): Promise<number>;

  // The derived half of the daily reconciliation. What it catches is not an outage but a
  // consumer that died quietly on a Tuesday.
  public abstract dailyCounts(
    organizationId: OrganizationId,
    from: Date,
    to: Date,
    excluding: readonly ActivityAction[],
  ): Promise<readonly DailyCount[]>;

  // One lightweight delete, so the derived copy forgets a deleted tenant rather than
  // holding it until the table's own TTL expires it years later.
  public abstract deleteTenant(organizationId: OrganizationId): Promise<void>;

  // The TTL the store currently holds, normalised. It exists so the caller can compare
  // before it writes: `MODIFY TTL` materialises on existing parts, which is a rewrite.
  public abstract retention(): Promise<string>;

  // One `ALTER TABLE … MODIFY TTL`. The expression is composed by `RetentionRules`, so
  // this method decides nothing about what the policy is.
  public abstract applyRetention(expression: string): Promise<void>;

  public abstract healthy(): Promise<boolean>;

  public abstract close(): Promise<void>;
}
