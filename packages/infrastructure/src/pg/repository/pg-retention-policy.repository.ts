import {
  and,
  eq,
  PartitionedTable,
  type PartitionedTableName,
  type Placement,
  type RetentionPolicyRecord,
  type RetentionPolicyRepository,
  type RetentionStore,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { retentionPolicy } from "../schema/index.js";

export class PgRetentionPolicyRepository
  extends BaseRepository
  implements RetentionPolicyRepository
{
  // Deployment-wide policy.
  protected override readonly placement: Placement = "catalog";

  public async all(): Promise<readonly RetentionPolicyRecord[]> {
    return this.db.select().from(retentionPolicy).orderBy(retentionPolicy.tableName);
  }

  public async findBy(
    store: RetentionStore,
    tableName: string,
  ): Promise<RetentionPolicyRecord | null> {
    const rows = await this.db
      .select()
      .from(retentionPolicy)
      .where(and(eq(retentionPolicy.store, store), eq(retentionPolicy.tableName, tableName)));

    return rows[0] ?? null;
  }

  // Upsert, because the screen edits a row that may not exist: an absent row *is* the
  // default, so the first save inserts and the caller should not have to know that.
  public async save(record: RetentionPolicyRecord): Promise<void> {
    await this.db
      .insert(retentionPolicy)
      .values({ ...record, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [retentionPolicy.store, retentionPolicy.tableName],
        set: {
          hotMonths: record.hotMonths,
          coldMonths: record.coldMonths,
          coldMode: record.coldMode,
          updatedAt: new Date(),
        },
      });
  }

  // One query for the whole prune pass, keyed by the closed union: a row naming a table
  // the allowlist no longer has is dropped here rather than reaching a `drop table`.
  public async forPostgres(): Promise<ReadonlyMap<PartitionedTableName, RetentionPolicyRecord>> {
    const rows = await this.db
      .select()
      .from(retentionPolicy)
      .where(eq(retentionPolicy.store, "postgres"));

    const known = new Set<string>(PartitionedTable.NAMES);

    return new Map(
      rows
        .filter((row) => known.has(row.tableName))
        .map((row) => [row.tableName as PartitionedTableName, row]),
    );
  }
}
