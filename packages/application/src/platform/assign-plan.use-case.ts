import { NotFoundError } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import type { PlatformReader } from "./platform.reader.js";
import type { ShardMapReader } from "./shard-map.reader.js";

export interface AssignPlanInput {
  // An organization id or a slug, whichever the operator is holding.
  readonly organization: string;
  readonly planKey: string;
}

// Moves one org to a plan. Its roles are untouched: a downgrade masks their extra keys, and
// moving back restores them with no role edit, because nothing was deleted.
export class AssignPlanUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly tenants: ShardMapReader,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: AssignPlanInput): Promise<void> {
    this.authorizer.assert(actor, "platform.entitlement.manage");

    const term = input.organization.trim();
    const tenant = await this.tenants.findByTerm(term);
    if (!tenant) throw new NotFoundError("organization", term);
    const plan = await this.entitlements.findPlan(input.planKey);
    if (!plan) throw new NotFoundError("plan", input.planKey);

    const previous = await this.entitlements.findPlanOf(tenant.organizationId);
    if (previous === plan.key) return;

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    // The org's own log too. `PgActivityLogger` relays the row to the org's node when this
    // catalog transaction cannot reach it, still committed with the change.
    const inTenant = new Principal(
      tenant.organizationId,
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.entitlements.savePlanOf(tenant.organizationId, plan.key);
      const entry = {
        organizationId: tenant.organizationId,
        slug: tenant.slug,
        from: previous ?? "",
        to: plan.key,
      };
      await this.activity.record(auditor, "organization.plan.changed", entry);
      await this.activity.record(inTenant, "organization.plan.changed", entry);
    });

    await this.capabilities.invalidateOrganization(tenant.organizationId);
  }
}
