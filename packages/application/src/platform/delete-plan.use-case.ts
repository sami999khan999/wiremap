import { ConflictError, NotFoundError } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import type { PlatformReader } from "./platform.reader.js";

export interface DeletePlanInput {
  readonly key: string;
}

// Only an unused plan goes. A plan in use would strand its orgs on a missing row, and the
// default is where every new signup lands.
export class DeletePlanUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: DeletePlanInput): Promise<void> {
    this.authorizer.assert(actor, "platform.entitlement.manage");

    const plan = await this.entitlements.findPlan(input.key);
    if (!plan) throw new NotFoundError("plan", input.key);
    if (plan.isSystem) throw new ConflictError("plan", "system");
    if (plan.organizations > 0) throw new ConflictError("plan", "in_use");
    if ((await this.entitlements.findDefaultPlan()) === plan.key) {
      throw new ConflictError("plan", "default");
    }

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.entitlements.deletePlan(plan.key);
      await this.activity.record(auditor, "plan.deleted", { key: plan.key });
    });

    await this.capabilities.invalidateAll();
  }
}
