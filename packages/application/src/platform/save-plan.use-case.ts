import { ConflictError } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository, PlanInput } from "./entitlement.repository.js";
import { EntitlementRules } from "./entitlement.rules.js";
import type { PlatformReader } from "./platform.reader.js";

// Creates or replaces a plan. The keys are stored closed over `requires`, so a plan cannot
// entitle `member.invite` without the role list its form reads.
export class SavePlanUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: PlanInput): Promise<void> {
    this.authorizer.assert(actor, "platform.entitlement.manage");

    const key = EntitlementRules.assertPlanKey(input.key);
    const permissions = EntitlementRules.closePlan(input.permissions);

    // `unlimited` is a property, not a list; editing its rows would change nothing.
    const existing = await this.entitlements.findPlan(key);
    if (existing?.isSystem) throw new ConflictError("plan", "system");

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.entitlements.savePlan({
        key,
        name: input.name.trim(),
        description: input.description.trim(),
        permissions,
      });
      await this.activity.record(auditor, "plan.saved", {
        key,
        permissions: permissions.length,
        created: existing === null,
      });
    });

    // Every holder of the plan, and the holders are not known here.
    await this.capabilities.invalidateAll();
  }
}
