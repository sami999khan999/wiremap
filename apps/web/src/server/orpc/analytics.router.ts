import { authed } from "../import.js";

// The tenant is the principal's. Nothing in the input names one, so a caller cannot
// read another tenant's activity by asking for it.
export class AnalyticsRouter {
  private constructor() {}

  public static readonly activity = authed.analytics.activity.handler(({ input, context }) =>
    context.container.analytics.activity.execute(context.principal, input),
  );

  public static readonly all = {
    activity: AnalyticsRouter.activity,
  };
}
