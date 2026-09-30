import type { FlagCache } from "../flag/index.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { WidgetRules } from "./widget.rules.js";
import type { WidgetPreferenceRepository } from "./widget-preference.repository.js";

export interface UpdateWidgetDefaultInput {
  readonly widget: string;
  readonly hidden: boolean;
}

// An admin hiding a card for everyone in the org. Audited, unlike a person's own hide:
// it is one person deciding what every other member sees.
export class UpdateWidgetDefaultUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly flags: FlagCache,
    private readonly preferences: WidgetPreferenceRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateWidgetDefaultInput): Promise<void> {
    await this.flags.assertOn(actor, "widget.dismissal");
    this.authorizer.assert(actor, "widget.default.manage");
    const widget = WidgetRules.assertDismissible(input.widget);

    await this.unitOfWork.run(async () => {
      if (input.hidden) await this.preferences.save(actor.organizationId, null, widget);
      else await this.preferences.delete(actor.organizationId, null, widget);
      await this.activity.record(
        actor,
        input.hidden ? "widget.default.hidden" : "widget.default.restored",
        { widget },
      );
    });
  }
}
