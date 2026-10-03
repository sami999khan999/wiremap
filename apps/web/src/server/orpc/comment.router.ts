import { authed } from "../import.js";

export class CommentRouter {
  private constructor() {}

  public static readonly list = authed.comment.list.handler(({ input, context }) =>
    context.container.comments.list(context.principal, input),
  );

  public static readonly create = authed.comment.create.handler(({ input, context }) =>
    context.container.comments.create(context.principal, input),
  );

  public static readonly update = authed.comment.update.handler(({ input, context }) =>
    context.container.comments.update(context.principal, input),
  );

  public static readonly remove = authed.comment.remove.handler(async ({ input, context }) => {
    await context.container.comments.remove(context.principal, input);
    return { ok: true as const };
  });

  public static readonly resolve = authed.comment.resolve.handler(({ input, context }) =>
    context.container.comments.resolve(context.principal, input),
  );

  public static readonly pin = authed.comment.pin.handler(({ input, context }) =>
    context.container.comments.pin(context.principal, input),
  );

  public static readonly all = {
    list: CommentRouter.list,
    create: CommentRouter.create,
    update: CommentRouter.update,
    remove: CommentRouter.remove,
    resolve: CommentRouter.resolve,
    pin: CommentRouter.pin,
  } as const;
}
