import { authed } from "../import.js";

export class GithubRouter {
  private constructor() {}

  public static readonly status = authed.github.status.handler(({ context }) =>
    context.container.github.status.execute(context.principal),
  );

  public static readonly all = {
    status: GithubRouter.status,
  } as const;
}
