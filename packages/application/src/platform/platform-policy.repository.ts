// The deployment-wide switches. One row, and an absent one is these defaults — so a
// deployment that never opens the screen behaves as the deploy before the table existed.
export interface PlatformPolicyRecord {
  // A pause, not a power switch: off stops the consumer projecting and nothing else.
  // The connection stays and the TTL is still converged nightly.
  readonly projectionEnabled: boolean;
  // Off by default, which is the safe direction: a stale replica read is a correctness
  // bug, and turning it on is a decision someone makes.
  readonly replicaReadsEnabled: boolean;
  // **Null is not zero.** It means "use the deployment's own default", the way an
  // absent `retention_policy` row means `PartitionedTable`'s value — decision `24.2`.
  readonly moveGraceDays: number | null;
}

export abstract class PlatformPolicyRepository {
  // Never null: an absent row is the defaults, and a caller branching on null would
  // be branching on "nobody has saved yet", which is not a state anything cares about.
  public abstract get(): Promise<PlatformPolicyRecord>;

  public abstract save(record: PlatformPolicyRecord): Promise<void>;
}
