import type { OrganizationId } from "../import.js";
import type { PartitionedTableName } from "../primitive/index.js";

export interface TenantRetentionPolicyRecord {
  readonly organizationId: OrganizationId;
  readonly tableName: string;
  readonly hotMonths: number;
  readonly coldMonths: number | null;
}

// Expressible only because decision D29 made a tenant's month its own partition: before
// that this meant a `DELETE` out of a partition everybody shared.
export abstract class TenantRetentionPolicyRepository {
  public abstract findBy(
    organizationId: OrganizationId,
    tableName: string,
  ): Promise<TenantRetentionPolicyRecord | null>;

  // Every override for one table. The prune pass takes its per-tenant path **only when
  // this is non-empty**, so the common case stays one call per table-month.
  public abstract forTable(
    tableName: PartitionedTableName,
  ): Promise<ReadonlyMap<OrganizationId, TenantRetentionPolicyRecord>>;

  public abstract save(record: TenantRetentionPolicyRecord): Promise<void>;

  // Every override a tenant holds, for the delete path: the rows lead with the tenant
  // and carry no foreign key, so nothing cascades them.
  public abstract deleteFor(organizationId: OrganizationId): Promise<void>;
}
