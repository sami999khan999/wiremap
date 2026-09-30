import {
  and,
  eq,
  type OrganizationId,
  type PartitionedTableName,
  type Placement,
  type TenantRetentionPolicyRecord,
  type TenantRetentionPolicyRepository,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { tenantRetentionPolicy } from "../schema/index.js";

export class PgTenantRetentionPolicyRepository
  extends BaseRepository
  implements TenantRetentionPolicyRepository
{
  // Policy, read by the prune pass before it knows a tenant.
  protected override readonly placement: Placement = "catalog";

  public async findBy(
    organizationId: OrganizationId,
    tableName: string,
  ): Promise<TenantRetentionPolicyRecord | null> {
    const rows = await this.db
      .select()
      .from(tenantRetentionPolicy)
      .where(
        and(
          eq(tenantRetentionPolicy.organizationId, organizationId),
          eq(tenantRetentionPolicy.tableName, tableName),
        ),
      );

    return rows[0] ?? null;
  }

  // One query per table for the whole prune pass, and usually zero rows — which is what
  // keeps the common case one call per table-month rather than one per tenant.
  public async forTable(
    tableName: PartitionedTableName,
  ): Promise<ReadonlyMap<OrganizationId, TenantRetentionPolicyRecord>> {
    const rows = await this.db
      .select()
      .from(tenantRetentionPolicy)
      .where(eq(tenantRetentionPolicy.tableName, tableName));

    return new Map(rows.map((row) => [row.organizationId, row]));
  }

  public async save(record: TenantRetentionPolicyRecord): Promise<void> {
    await this.db
      .insert(tenantRetentionPolicy)
      .values({ ...record, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [tenantRetentionPolicy.organizationId, tenantRetentionPolicy.tableName],
        set: {
          hotMonths: record.hotMonths,
          coldMonths: record.coldMonths,
          updatedAt: new Date(),
        },
      });
  }

  public async deleteFor(organizationId: OrganizationId): Promise<void> {
    await this.db
      .delete(tenantRetentionPolicy)
      .where(eq(tenantRetentionPolicy.organizationId, organizationId));
  }
}
