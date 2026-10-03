import { authed } from "../import.js";

export class WebhookRouter {
  private constructor() {}

  public static readonly list = authed.webhook.list.handler(({ context }) =>
    context.container.webhooks.manage.list(context.principal),
  );

  public static readonly create = authed.webhook.create.handler(({ input, context }) =>
    context.container.webhooks.manage.create(context.principal, input),
  );

  public static readonly update = authed.webhook.update.handler(({ input, context }) =>
    context.container.webhooks.manage.update(context.principal, input),
  );

  public static readonly remove = authed.webhook.remove.handler(async ({ input, context }) => {
    await context.container.webhooks.manage.remove(context.principal, input);
    return { ok: true as const };
  });

  public static readonly test = authed.webhook.test.handler(({ input, context }) =>
    context.container.webhooks.manage.test(context.principal, input),
  );

  public static readonly all = {
    list: WebhookRouter.list,
    create: WebhookRouter.create,
    update: WebhookRouter.update,
    remove: WebhookRouter.remove,
    test: WebhookRouter.test,
  } as const;
}
