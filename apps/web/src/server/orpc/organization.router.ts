import { authed } from "../import.js";

// The caller's own organization; no procedure here takes an organization id.
export class OrganizationRouter {
  private constructor() {}

  public static readonly get = authed.organization.get.handler(({ context }) =>
    context.container.organization.get.execute(context.principal),
  );

  public static readonly update = authed.organization.update.handler(({ input, context }) =>
    context.container.organization.update.execute(context.principal, input),
  );

  public static readonly transferOwnership = authed.organization.transferOwnership.handler(
    async ({ input, context }) => {
      await context.container.organization.transferOwnership.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  public static readonly remove = authed.organization.remove.handler(async ({ input, context }) => {
    await context.container.organization.remove.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly all = {
    get: OrganizationRouter.get,
    update: OrganizationRouter.update,
    transferOwnership: OrganizationRouter.transferOwnership,
    remove: OrganizationRouter.remove,
  } as const;
}
