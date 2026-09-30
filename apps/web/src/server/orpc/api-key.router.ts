import { authed } from "../import.js";

// Three lines per procedure, as `RoleRouter`. `create` is the exception worth noticing:
// the plaintext token exists in this response and nowhere else, ever.
export class ApiKeyRouter {
  private constructor() {}

  public static readonly list = authed.apiKey.list.handler(({ input, context }) =>
    context.container.apiKey.listApiKeys.execute(context.principal, input),
  );

  public static readonly create = authed.apiKey.create.handler(({ input, context }) =>
    context.container.apiKey.createApiKey.execute(context.principal, {
      ...input,
      scopes: [...input.scopes],
    }),
  );

  public static readonly revoke = authed.apiKey.revoke.handler(({ input, context }) =>
    context.container.apiKey.revokeApiKey.execute(context.principal, input),
  );

  // The object the merge point in `app.router.ts` mounts, mirroring `ApiKeyProcedures.all`.
  public static readonly all = {
    list: ApiKeyRouter.list,
    create: ApiKeyRouter.create,
    revoke: ApiKeyRouter.revoke,
  } as const;
}
