import {
  type OrganizationId,
  type PartitionedTableName,
  type TenantRetentionPolicyRecord,
  TenantRetentionPolicyRepository,
} from "../import.js";

// Empty by default, and that default is the state that matters: an override is what
// makes the prune pass walk tenants rather than months, so most specs want none.
export class InMemoryTenantRetentionPolicyRepository extends TenantRetentionPolicyRepository {
  private readonly rows = new Map<string, TenantRetentionPolicyRecord>();

  public constructor(rows: readonly TenantRetentionPolicyRecord[] = []) {
    super();
    for (const row of rows) this.rows.set(`${row.organizationId}:${row.tableName}`, row);
  }

  public override findBy(
    organizationId: OrganizationId,
    tableName: string,
  ): Promise<TenantRetentionPolicyRecord | null> {
    return Promise.resolve(this.rows.get(`${organizationId}:${tableName}`) ?? null);
  }

  public override forTable(
    tableName: PartitionedTableName,
  ): Promise<ReadonlyMap<OrganizationId, TenantRetentionPolicyRecord>> {
    return Promise.resolve(
      new Map(
        [...this.rows.values()]
          .filter((row) => row.tableName === tableName)
          .map((row) => [row.organizationId, row]),
      ),
    );
  }

  public override save(record: TenantRetentionPolicyRecord): Promise<void> {
    this.rows.set(`${record.organizationId}:${record.tableName}`, record);
    return Promise.resolve();
  }

  public override deleteFor(organizationId: OrganizationId): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.organizationId === organizationId) this.rows.delete(key);
    }
    return Promise.resolve();
  }
}
