import { NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import type { PlatformReader } from "./platform.reader.js";

export interface UpdateDefaultPlanInput {
  readonly key: string;
}

// What the next signup lands on (`RV.14`). No existing org moves and no cache entry
// changes, so nothing is invalidated: only an org founded after this reads it.
export class UpdateDefaultPlanUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateDefaultPlanInput): Promise<void> {
    this.authorizer.assert(actor, "platform.entitlement.manage");

    const plan = await this.entitlements.findPlan(input.key);
    if (!plan) throw new NotFoundError("plan", input.key);

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.entitlements.saveDefaultPlan(plan.key);
      await this.activity.record(auditor, "plan.default.changed", { key: plan.key });
    });
  }
}
