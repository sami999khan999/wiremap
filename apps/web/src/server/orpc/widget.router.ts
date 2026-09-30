import { authed } from "../import.js";

// Each use-case asks the flag, then its key; this file only moves input in and a result out.
export class WidgetRouter {
  private constructor() {}

  public static readonly preferences = authed.widget.preferences.handler(({ context }) =>
    context.container.widget.preferences.execute(context.principal, {}),
  );

  public static readonly preferencesOf = authed.widget.preferencesOf.handler(({ input, context }) =>
    context.container.widget.preferences.execute(context.principal, input),
  );

  public static readonly updatePreference = authed.widget.updatePreference.handler(
    async ({ input, context }) => {
      await context.container.widget.updatePreference.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly updateDefault = authed.widget.updateDefault.handler(
    async ({ input, context }) => {
      await context.container.widget.updateDefault.execute(context.principal, input);
      return { ok: true } as const;
    },
  );

  public static readonly all = {
    preferences: WidgetRouter.preferences,
    preferencesOf: WidgetRouter.preferencesOf,
    updatePreference: WidgetRouter.updatePreference,
    updateDefault: WidgetRouter.updateDefault,
  } as const;
}
