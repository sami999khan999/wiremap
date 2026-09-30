import { NotFoundError, type UserId } from "../import.js";
import type { TenantMembershipReader } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type {
  WidgetPreferenceRepository,
  WidgetPreferences,
} from "./widget-preference.repository.js";

export interface GetWidgetPreferencesInput {
  // Absent for your own. Another member's is the inspector's question, not a dashboard's.
  readonly userId?: UserId;
}

export class GetWidgetPreferencesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly preferences: WidgetPreferenceRepository,
    private readonly memberships: TenantMembershipReader,
  ) {}

  public async execute(
    actor: Principal,
    input: GetWidgetPreferencesInput,
  ): Promise<WidgetPreferences> {
    const userId = input.userId ?? actor.userId;

    if (userId === actor.userId) {
      this.authorizer.assert(actor, "core.widget.customize");
    } else {
      this.authorizer.assert(actor, "rbac.effective.inspect");
      if (!(await this.memberships.isActiveMember(actor.organizationId, userId))) {
        throw new NotFoundError("member", userId);
      }
    }

    return this.preferences.findFor(actor.organizationId, userId);
  }
}
