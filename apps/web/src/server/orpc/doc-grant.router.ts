import { authed } from "../import.js";

// A platform admin's, from whichever organization they are acting in: a grant is catalog
// policy, and each use-case asserts `platform.doc.grant` itself.
export class DocGrantRouter {
  private constructor() {}

  public static readonly list = authed.docGrant.list.handler(({ input, context }) =>
    context.container.doc.listGrants.execute(context.principal, input),
  );

  public static readonly save = authed.docGrant.save.handler(({ input, context }) =>
    context.container.doc.saveGrant.execute(context.principal, input),
  );

  public static readonly revoke = authed.docGrant.revoke.handler(async ({ input, context }) => {
    await context.container.doc.revokeGrant.execute(context.principal, input);
    return { ok: true } as const;
  });

  public static readonly all = {
    list: DocGrantRouter.list,
    save: DocGrantRouter.save,
    revoke: DocGrantRouter.revoke,
  } as const;
}
