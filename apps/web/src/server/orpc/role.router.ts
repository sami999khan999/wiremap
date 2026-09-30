import { authed } from "../import.js";

// Three lines per procedure and nothing else: no business logic, no authorization, no
// error mapping — which is what makes a framework swap a rewrite of this file alone.
export class RoleRouter {
  private constructor() {}

  public static readonly list = authed.role.list.handler(({ input, context }) =>
    context.container.rbac.listRoles.execute(context.principal, input),
  );

  // The set goes out as its DTO and the ceiling as its keys: the domain holds a
  // `CapabilitySet` and an `EntitlementMask`, and the contract declares their wire shapes.
  public static readonly effective = authed.role.effective.handler(async ({ input, context }) => {
    const { capabilities, explanation } = await context.container.rbac.inspectEffective.execute(
      context.principal,
      input,
    );

    return {
      capabilities: capabilities.toJSON(),
      explanation: {
        roleGrants: explanation.roleGrants,
        goalGrants: explanation.goalGrants,
        overrides: explanation.overrides,
        entitled: explanation.entitlement.keys(),
      },
    };
  });

  public static readonly create = authed.role.create.handler(({ input, context }) =>
    context.container.rbac.createRole.execute(context.principal, input),
  );

  public static readonly update = authed.role.update.handler(({ input, context }) =>
    context.container.rbac.updateRole.execute(context.principal, input),
  );

  // The `{ ok: true }` is the transport's word, not the domain's — the use-case
  // returns nothing, as `revokeInvitation` does.
  public static readonly remove = authed.role.remove.handler(async ({ input, context }) => {
    await context.container.rbac.deleteRole.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly grant = authed.role.grant.handler(({ input, context }) =>
    context.container.rbac.grantPermission.execute(context.principal, input),
  );

  public static readonly revoke = authed.role.revoke.handler(({ input, context }) =>
    context.container.rbac.revokePermission.execute(context.principal, input),
  );

  // The object the merge point in `app.router.ts` mounts, mirroring `RoleProcedures.all`.
  public static readonly entitlement = authed.role.entitlement.handler(async ({ context }) => ({
    keys: await context.container.rbac.entitlement.execute(context.principal),
  }));

  public static readonly all = {
    list: RoleRouter.list,
    effective: RoleRouter.effective,
    entitlement: RoleRouter.entitlement,
    create: RoleRouter.create,
    update: RoleRouter.update,
    remove: RoleRouter.remove,
    grant: RoleRouter.grant,
    revoke: RoleRouter.revoke,
  } as const;
}
