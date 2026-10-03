import { authed } from "../import.js";

export class TeamRouter {
  private constructor() {}

  public static readonly list = authed.team.list.handler(async ({ input, context }) => ({
    ...(await context.container.teams.list.execute(context.principal, input)),
    limit: input.limit,
    offset: input.offset,
  }));

  public static readonly members = authed.team.members.handler(({ input, context }) =>
    context.container.teams.members.execute(context.principal, input),
  );

  public static readonly create = authed.team.create.handler(({ input, context }) =>
    context.container.teams.create.execute(context.principal, input),
  );

  public static readonly update = authed.team.update.handler(({ input, context }) =>
    context.container.teams.update.execute(context.principal, input),
  );

  public static readonly remove = authed.team.remove.handler(async ({ input, context }) => {
    await context.container.teams.remove.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly addMember = authed.team.addMember.handler(async ({ input, context }) => {
    await context.container.teams.addMember.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly removeMember = authed.team.removeMember.handler(
    async ({ input, context }) => {
      await context.container.teams.removeMember.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  public static readonly all = {
    list: TeamRouter.list,
    members: TeamRouter.members,
    create: TeamRouter.create,
    update: TeamRouter.update,
    remove: TeamRouter.remove,
    addMember: TeamRouter.addMember,
    removeMember: TeamRouter.removeMember,
  } as const;
}
