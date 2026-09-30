import {
  type PartitionedTableName,
  type RetentionPolicyRecord,
  RetentionPolicyRepository,
  type RetentionStore,
} from "../import.js";

// Rows in a Map, keyed the way the table is. Empty by default, which is the state that
// matters: an absent row is the code default, so staging nothing asserts that.
export class InMemoryRetentionPolicyRepository extends RetentionPolicyRepository {
  private readonly rows = new Map<string, RetentionPolicyRecord>();

  public constructor(rows: readonly RetentionPolicyRecord[] = []) {
    super();
    for (const row of rows) this.rows.set(InMemoryRetentionPolicyRepository.keyOf(row), row);
  }

  public override all(): Promise<readonly RetentionPolicyRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  public override findBy(
    store: RetentionStore,
    tableName: string,
  ): Promise<RetentionPolicyRecord | null> {
    return Promise.resolve(this.rows.get(`${store}:${tableName}`) ?? null);
  }

  public override save(record: RetentionPolicyRecord): Promise<void> {
    this.rows.set(InMemoryRetentionPolicyRepository.keyOf(record), record);
    return Promise.resolve();
  }

  public override forPostgres(): Promise<ReadonlyMap<PartitionedTableName, RetentionPolicyRecord>> {
    return Promise.resolve(
      new Map(
        [...this.rows.values()]
          .filter((row) => row.store === "postgres")
          .map((row) => [row.tableName as PartitionedTableName, row]),
      ),
    );
  }

  private static keyOf(record: RetentionPolicyRecord): string {
    return `${record.store}:${record.tableName}`;
  }
}
