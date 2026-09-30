import type { FlagCache } from "../flag/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { WidgetRules } from "./widget.rules.js";
import type { WidgetPreferenceRepository } from "./widget-preference.repository.js";

export interface UpdateWidgetPreferenceInput {
  readonly widget: string;
  readonly hidden: boolean;
}

// One person hiding or restoring a card on their own dashboard. Not audited: it changes
// nothing anyone may do, and an audit row per click is a retention bill for nothing.
export class UpdateWidgetPreferenceUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly flags: FlagCache,
    private readonly preferences: WidgetPreferenceRepository,
  ) {}

  public async execute(actor: Principal, input: UpdateWidgetPreferenceInput): Promise<void> {
    // The flag before the permission: a feature this org does not have yet is not a
    // feature the caller lacks a key for.
    await this.flags.assertOn(actor, "widget.dismissal");
    this.authorizer.assert(actor, "core.widget.customize");
    const widget = WidgetRules.assertDismissible(input.widget);

    if (input.hidden) {
      await this.preferences.save(actor.organizationId, actor.userId, widget);
      return;
    }

    WidgetRules.assertRestorable(
      await this.preferences.findFor(actor.organizationId, actor.userId),
      widget,
    );
    await this.preferences.delete(actor.organizationId, actor.userId, widget);
  }
}
