import type { ActivityAction } from "../import.js";

export interface ProjectionPolicyRecord {
  readonly action: ActivityAction;
  readonly projected: boolean;
  // Null is "the default clause covers it". A number is a `DELETE WHERE action =`
  // clause of its own, which is what keeps one action longer than the rest.
  readonly ttlMonths: number | null;
}

// One row per action, and an absent row is "projected, with the default TTL" — so an
// empty table behaves exactly as the deploy before it existed.
export abstract class ProjectionPolicyRepository {
  // Every row, because every reader needs the whole set: the consumer composes one
  // exclusion list per run and the TTL is one expression over all of them.
  public abstract all(): Promise<readonly ProjectionPolicyRecord[]>;

  public abstract save(record: ProjectionPolicyRecord): Promise<void>;
}
