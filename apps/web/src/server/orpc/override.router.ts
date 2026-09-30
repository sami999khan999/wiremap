import { authed } from "../import.js";

// Three lines per procedure. Each use-case asserts its own key and checks escalation,
// outranking and self; this file only moves input in and a result out.
export class OverrideRouter {
  private constructor() {}

  public static readonly list = authed.override.list.handler(async ({ input, context }) => ({
    items: await context.container.overrides.list.execute(context.principal, input),
  }));

  public static readonly grant = authed.override.grant.handler(async ({ input, context }) => ({
    permissions: await context.container.overrides.grant.execute(context.principal, input),
  }));

  public static readonly deny = authed.override.deny.handler(async ({ input, context }) => ({
    permissions: await context.container.overrides.deny.execute(context.principal, input),
  }));

  public static readonly clear = authed.override.clear.handler(async ({ input, context }) => {
    await context.container.overrides.clear.execute(context.principal, input);
    return { ok: true } as const;
  });

  public static readonly all = {
    list: OverrideRouter.list,
    grant: OverrideRouter.grant,
    deny: OverrideRouter.deny,
    clear: OverrideRouter.clear,
  } as const;
}
