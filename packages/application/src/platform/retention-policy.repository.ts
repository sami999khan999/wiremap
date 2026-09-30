import type { PartitionedTableName } from "../primitive/index.js";

// Two meanings of "retention" — a Postgres partition is dropped, a ClickHouse row
// expires under a TTL — and one table, because one screen edits them side by side.
export type RetentionStore = "postgres" | "clickhouse";

// `drop` skips the archive step. Named rather than a boolean, because "archive" is the
// default and a `skipArchive: false` reads as the opposite of what it does.
export type ColdMode = "archive" | "drop";

export interface RetentionPolicyRecord {
  readonly store: RetentionStore;
  // `PartitionedTableName` for a postgres row; the analytics table's name for the
  // clickhouse one. Wide here because the row is data; narrow at the use-case.
  readonly tableName: string;
  readonly hotMonths: number;
  // Null is "never expires", which is not zero — zero deletes the object as soon as it
  // lands in cold storage.
  readonly coldMonths: number | null;
  readonly coldMode: ColdMode;
}

// A repository port, so it lives with its slice. Global rows, no tenant on any method:
// a partition spans every tenant, so this policy could not be per tenant if it tried.
export abstract class RetentionPolicyRepository {
  // Every row, because every caller wants every row: the lifecycle configuration is
  // composed from all of them at once, and S3 replaces the whole thing or none of it.
  public abstract all(): Promise<readonly RetentionPolicyRecord[]>;

  public abstract findBy(
    store: RetentionStore,
    tableName: string,
  ): Promise<RetentionPolicyRecord | null>;

  public abstract save(record: RetentionPolicyRecord): Promise<void>;

  // What the prune pass reads, once per run rather than once per table: it walks the
  // whole allowlist, and a query per table is a query per table forever.
  public abstract forPostgres(): Promise<ReadonlyMap<PartitionedTableName, RetentionPolicyRecord>>;
}
