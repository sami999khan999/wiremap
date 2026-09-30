import { authed } from "../import.js";

export class MessageRouter {
  private constructor() {}

  public static readonly list = authed.message.list.handler(({ input, context }) =>
    context.container.messaging.listMessages.execute(context.principal, input),
  );

  public static readonly send = authed.message.send.handler(({ input, context }) =>
    context.container.messaging.send.execute(context.principal, input),
  );

  public static readonly edit = authed.message.edit.handler(({ input, context }) =>
    context.container.messaging.edit.execute(context.principal, input),
  );

  public static readonly remove = authed.message.remove.handler(async ({ input, context }) => {
    await context.container.messaging.remove.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly typing = authed.message.typing.handler(async ({ input, context }) => {
    await context.container.messaging.typing.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly all = {
    list: MessageRouter.list,
    send: MessageRouter.send,
    edit: MessageRouter.edit,
    remove: MessageRouter.remove,
    typing: MessageRouter.typing,
  };
}
