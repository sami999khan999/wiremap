import type { OrganizationId } from "../import.js";

// One day's count of one action. `day` is ISO `YYYY-MM-DD` in UTC, whichever store
// answered: each adapter normalises its own date shape to this one.
export interface ActivityCount {
  readonly day: string;
  readonly action: string;
  readonly count: number;
}

// The read side of the analytics store — `23.14`. Its own port, never a method on
// `AnalyticsProjector`: a dashboard query must not hold the object that can `project()`.
// ──
// **Read-only by construction.** A write here is the moment a derived store becomes a
// source of truth. See docs/opinions/data-and-scale.md.
export abstract class AnalyticsReader {
  // The tenant arrives resolved, never a `Principal`: the store holds no capability set
  // and can join back to nothing. `[from, to)`, both ISO days.
  public abstract activityByDay(
    organizationId: OrganizationId,
    from: string,
    to: string,
  ): Promise<readonly ActivityCount[]>;
}
