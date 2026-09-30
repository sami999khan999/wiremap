import { NotFoundError } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import type { PlatformReader } from "./platform.reader.js";
import type { ShardMapReader } from "./shard-map.reader.js";

export interface ClearEntitlementAdjustmentInput {
  readonly organization: string;
  readonly permission: string;
}

// Back to what the plan says for one key. One row, not its closure: clearing a trial's
// `invite` leaves the role list it brought, which the plan may well include anyway.
export class ClearEntitlementAdjustmentUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly tenants: ShardMapReader,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: ClearEntitlementAdjustmentInput): Promise<void> {
    this.authorizer.assert(actor, "platform.entitlement.manage");

    const term = input.organization.trim();
    const tenant = await this.tenants.findByTerm(term);
    if (!tenant) throw new NotFoundError("organization", term);

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    const inTenant = new Principal(
      tenant.organizationId,
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    const cleared = await this.unitOfWork.run(async () => {
      const removed = await this.entitlements.deleteAdjustment(
        tenant.organizationId,
        input.permission,
      );
      if (removed) {
        const entry = {
          organizationId: tenant.organizationId,
          slug: tenant.slug,
          permission: input.permission,
        };
        await this.activity.record(auditor, "entitlement.adjustment.cleared", entry);
        await this.activity.record(inTenant, "entitlement.adjustment.cleared", entry);
      }
      return removed;
    });

    if (cleared) await this.capabilities.invalidateOrganization(tenant.organizationId);
  }
}
