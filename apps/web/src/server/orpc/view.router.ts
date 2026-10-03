import { authed } from "../import.js";

export class ViewRouter {
  private constructor() {}

  public static readonly list = authed.view.list.handler(({ input, context }) =>
    context.container.views.list(context.principal, input.projectId),
  );

  public static readonly save = authed.view.save.handler(({ input, context }) =>
    context.container.views.save(context.principal, input),
  );

  public static readonly remove = authed.view.remove.handler(async ({ input, context }) => {
    await context.container.views.remove(context.principal, input);
    return { ok: true as const };
  });

  public static readonly all = {
    list: ViewRouter.list,
    save: ViewRouter.save,
    remove: ViewRouter.remove,
  } as const;
}
