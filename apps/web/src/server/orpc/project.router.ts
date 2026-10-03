import { authed, NotFoundError } from "../import.js";

export class ProjectRouter {
  private constructor() {}

  public static readonly list = authed.project.list.handler(async ({ input, context }) => ({
    ...(await context.container.projects.list.execute(context.principal, input)),
    limit: input.limit,
    offset: input.offset,
  }));

  public static readonly get = authed.project.get.handler(({ input, context }) =>
    context.container.projects.get.execute(context.principal, input),
  );

  public static readonly create = authed.project.create.handler(({ input, context }) =>
    context.container.projects.create.execute(context.principal, input),
  );

  public static readonly update = authed.project.update.handler(({ input, context }) =>
    context.container.projects.update.execute(context.principal, input),
  );

  public static readonly remove = authed.project.remove.handler(async ({ input, context }) => {
    await context.container.projects.remove.execute(context.principal, input);
    return { ok: true as const };
  });

  public static readonly available = authed.project.available.handler(({ context }) =>
    context.container.projects.available.execute(context.principal),
  );

  public static readonly addRepository = authed.project.addRepository.handler(
    ({ input, context }) =>
      context.container.projects.repository.execute(context.principal, {
        kind: "add",
        projectId: input.projectId,
        externalId: input.externalId,
      }),
  );

  public static readonly updateRepository = authed.project.updateRepository.handler(
    ({ input, context }) =>
      context.container.projects.repository.execute(context.principal, {
        kind: "update",
        ...input,
      }),
  );

  public static readonly removeRepository = authed.project.removeRepository.handler(
    ({ input, context }) =>
      context.container.projects.repository.execute(context.principal, {
        kind: "remove",
        ...input,
      }),
  );

  public static readonly access = authed.project.access.handler(({ input, context }) =>
    context.container.projects.access.execute(context.principal, {
      kind: "list",
      projectId: input.projectId,
    }),
  );

  // The use-case answers with every grant; the procedure answers with the one just saved.
  public static readonly saveGrant = authed.project.saveGrant.handler(
    async ({ input, context }) => {
      const grants = await context.container.projects.access.execute(context.principal, {
        kind: "save",
        ...input,
      });
      const saved = grants.find((grant) =>
        input.userId ? grant.userId === input.userId : grant.teamId === input.teamId,
      );
      if (!saved) throw new NotFoundError("grant", input.projectId);
      return saved;
    },
  );

  public static readonly revokeGrant = authed.project.revokeGrant.handler(
    async ({ input, context }) => {
      await context.container.projects.access.execute(context.principal, {
        kind: "revoke",
        ...input,
      });
      return { ok: true as const };
    },
  );

  public static readonly accessOverview = authed.project.accessOverview.handler(({ context }) =>
    context.container.projects.accessOverview.execute(context.principal),
  );

  public static readonly all = {
    list: ProjectRouter.list,
    get: ProjectRouter.get,
    create: ProjectRouter.create,
    update: ProjectRouter.update,
    remove: ProjectRouter.remove,
    available: ProjectRouter.available,
    addRepository: ProjectRouter.addRepository,
    updateRepository: ProjectRouter.updateRepository,
    removeRepository: ProjectRouter.removeRepository,
    access: ProjectRouter.access,
    saveGrant: ProjectRouter.saveGrant,
    revokeGrant: ProjectRouter.revokeGrant,
    accessOverview: ProjectRouter.accessOverview,
  } as const;
}
