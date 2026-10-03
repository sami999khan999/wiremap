import { authed } from "../import.js";

export class ActivityRouter {
  private constructor() {}

  public static readonly list = authed.activity.list.handler(({ input, context }) =>
    context.container.activityLog.list.execute(context.principal, input),
  );

  public static readonly project = authed.activity.project.handler(({ input, context }) =>
    context.container.activityLog.project.execute(context.principal, input),
  );

  public static readonly all = {
    list: ActivityRouter.list,
    project: ActivityRouter.project,
  } as const;
}
