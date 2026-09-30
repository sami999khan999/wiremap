import { authed } from "../import.js";

// Moves input in and a result out. The space's audience rules live in the use-cases.
export class DocSpaceRouter {
  private constructor() {}

  public static readonly list = authed.docSpace.list.handler(({ context }) =>
    context.container.doc.listSpaces.execute(context.principal),
  );

  public static readonly get = authed.docSpace.get.handler(({ input, context }) =>
    context.container.doc.getSpace.execute(context.principal, input),
  );

  public static readonly create = authed.docSpace.create.handler(({ input, context }) =>
    context.container.doc.createSpace.execute(context.principal, input),
  );

  public static readonly update = authed.docSpace.update.handler(({ input, context }) =>
    context.container.doc.updateSpace.execute(context.principal, input),
  );

  public static readonly remove = authed.docSpace.remove.handler(async ({ input, context }) => {
    await context.container.doc.deleteSpace.execute(context.principal, input);
    return { ok: true } as const;
  });

  public static readonly all = {
    list: DocSpaceRouter.list,
    get: DocSpaceRouter.get,
    create: DocSpaceRouter.create,
    update: DocSpaceRouter.update,
    remove: DocSpaceRouter.remove,
  } as const;
}
