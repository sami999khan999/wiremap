import { type OrganizationId, ValidationError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { PartitionedTable, Principal } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { TenantRetentionPolicyRepository } from "./tenant-retention-policy.repository.js";

export interface UpdateTenantRetentionInput {
  readonly organizationId: OrganizationId;
  readonly tableName: string;
  readonly hotMonths: number;
  readonly coldMonths: number | null;
}

export class UpdateTenantRetentionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly policies: TenantRetentionPolicyRepository,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateTenantRetentionInput): Promise<void> {
    this.authorizer.assert(actor, "platform.retention.manage");

    // Tenant-partitioned, and **already retired by the calendar**: an override on a
    // table whose default is null would save, read back, and do nothing.
    const table = PartitionedTable.MONTH_PARTITIONED.find(
      (entry) =>
        entry.name === input.tableName &&
        entry.tenantKey !== null &&
        entry.retentionMonths !== null,
    );
    if (!table) throw new ValidationError([{ field: "tableName", rule: "unknown" }]);

    if (!Number.isInteger(input.hotMonths) || input.hotMonths < 1) {
      throw new ValidationError([{ field: "hotMonths", rule: "min" }]);
    }
    if (
      input.coldMonths !== null &&
      (!Number.isInteger(input.coldMonths) || input.coldMonths < 0)
    ) {
      throw new ValidationError([{ field: "coldMonths", rule: "min" }]);
    }

    // Under the tier, not under the tenant being configured: this is a platform admin
    // changing a global-tier setting that happens to name one customer.
    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.policies.save({
        organizationId: input.organizationId,
        tableName: table.name,
        hotMonths: input.hotMonths,
        coldMonths: input.coldMonths,
      });

      await this.activity.record(auditor, "tenant.retention.changed", {
        organizationId: input.organizationId,
        tableName: table.name,
        hotMonths: input.hotMonths,
        coldMonths: input.coldMonths,
      });
    });
  }
}
