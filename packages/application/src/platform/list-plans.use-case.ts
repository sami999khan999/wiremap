import type { Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository, PlanRecord } from "./entitlement.repository.js";

export interface PlanList {
  readonly items: readonly PlanRecord[];
  // What a new signup lands on, marked on the screen and refused by a delete.
  readonly defaultPlanKey: string;
}

export class ListPlansUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
  ) {}

  public async execute(actor: Principal): Promise<PlanList> {
    this.authorizer.assert(actor, "platform.entitlement.read");

    const [items, defaultPlanKey] = await Promise.all([
      this.entitlements.findPlans(),
      this.entitlements.findDefaultPlan(),
    ]);
    return { items, defaultPlanKey };
  }
}
