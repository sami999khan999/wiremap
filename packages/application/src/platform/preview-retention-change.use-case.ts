import { type OrganizationId, ValidationError } from "../import.js";
import type { MaintenanceGateway } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { PartitionedTable, type PartitionedTableName } from "../primitive/index.js";

export interface PreviewRetentionChangeInput {
  readonly tableName: string;
  // The value being typed, not the value saved. A preview of what is already stored
  // would tell an operator nothing they did not already have.
  readonly hotMonths: number;
  // Absent previews the table across every tenant. Present previews that one tenant's
  // months, which is what the row on `/platform/retention` is actually editing.
  readonly organizationId?: OrganizationId;
}

export interface PreviewedPartition {
  readonly name: string;
  readonly period: string;
  readonly estimatedRows: number;
  readonly bytes: number;
}

export interface RetentionPreview {
  readonly tableName: string;
  readonly hotMonths: number;
  // Echoed rather than assumed by the caller: a screen with two previews in flight
  // would otherwise render one tenant's numbers under the other's heading.
  readonly organizationId: OrganizationId | null;
  readonly partitions: readonly PreviewedPartition[];
  readonly totalPartitions: number;
  // The planner's number, refreshed by autovacuum and `-1` on a child never analysed —
  // which is why the screen says "about" and this is not called `rows`.
  readonly estimatedRows: number;
  readonly bytes: number;
}

// What the next run would retire, before the save rather than after it. Lowering a
// retention number used to schedule a mass drop with nothing on screen about it.
export class PreviewRetentionChangeUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly maintenance: MaintenanceGateway,
    private readonly clock: { now(): Date },
  ) {}

  public async execute(
    actor: Principal,
    input: PreviewRetentionChangeInput,
  ): Promise<RetentionPreview> {
    // Read, not manage: seeing the consequence must not require the right to cause it.
    this.authorizer.assert(actor, "platform.retention.read");

    const table = PreviewRetentionChangeUseCase.assertKnownTable(
      input.tableName,
      input.organizationId !== undefined,
    );
    if (!Number.isInteger(input.hotMonths) || input.hotMonths < 1) {
      throw new ValidationError([{ field: "hotMonths", rule: "min" }]);
    }

    // The same arithmetic `prune()` runs, deliberately duplicated in neither: this is
    // the one place both would disagree, so the preview computes it the same way.
    const now = this.clock.now();
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - input.hotMonths, 1));

    const estimates = await this.maintenance.partitionsBefore(
      table,
      cutoff,
      input.organizationId ?? null,
    );

    return {
      tableName: table,
      hotMonths: input.hotMonths,
      organizationId: input.organizationId ?? null,
      partitions: estimates.map((estimate) => ({
        name: estimate.name,
        period: estimate.period.toISOString().slice(0, 10),
        estimatedRows: estimate.estimatedRows,
        bytes: estimate.bytes,
      })),
      totalPartitions: estimates.length,
      estimatedRows: estimates.reduce((total, estimate) => total + estimate.estimatedRows, 0),
      bytes: estimates.reduce((total, estimate) => total + estimate.bytes, 0),
    };
  }

  // Never a free string, for the reason decision D37 gives: the name reaches DDL.
  // ──
  // `forTenant` narrows it to exactly what `UpdateTenantRetentionUseCase` will accept, so
  // the screen cannot preview an override that would be refused on save: a table with no
  // ──
  // tenant key has no per-tenant months, and one the calendar never retires would save,
  // read back and do nothing.
  private static assertKnownTable(tableName: string, forTenant: boolean): PartitionedTableName {
    const known = PartitionedTable.MONTH_PARTITIONED.find(
      (entry) =>
        entry.name === tableName &&
        (!forTenant || (entry.tenantKey !== null && entry.retentionMonths !== null)),
    );
    if (!known) throw new ValidationError([{ field: "tableName", rule: "unknown" }]);
    return known.name;
  }
}
