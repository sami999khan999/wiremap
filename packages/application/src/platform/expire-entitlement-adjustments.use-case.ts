import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import type { PlatformReader } from "./platform.reader.js";

export interface ExpiredAdjustments {
  readonly adjustments: number;
}

// The worker's nightly tidy. An expired row already grants nothing — resolution ignores it
// — so this only removes it, audits it, and flushes each org that had one.
export class ExpireEntitlementAdjustmentsUseCase {
  public constructor(
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  // No permission is asserted: the caller is the worker's system principal, and this runs
  // on no request path. The audit names that principal's reserved user.
  public async execute(system: Principal, now: Date): Promise<ExpiredAdjustments> {
    const expired = await this.entitlements.findExpired(now);
    if (expired.length === 0) return { adjustments: 0 };

    const auditor = new Principal(
      await this.platform.organizationId(),
      system.userId,
      system.capabilities,
      system.kind,
    );

    await this.unitOfWork.run(async () => {
      for (const row of expired) {
        await this.entitlements.deleteAdjustment(row.organizationId, row.permission);
        const entry = {
          organizationId: row.organizationId,
          permission: row.permission,
          effect: row.effect,
        };
        const inTenant = new Principal(
          row.organizationId,
          system.userId,
          system.capabilities,
          system.kind,
        );
        await this.activity.record(auditor, "entitlement.adjustment.expired", entry);
        await this.activity.record(inTenant, "entitlement.adjustment.expired", entry);
      }
    });

    for (const organizationId of new Set(expired.map((row) => row.organizationId))) {
      await this.capabilities.invalidateOrganization(organizationId);
    }
    return { adjustments: expired.length };
  }
}
