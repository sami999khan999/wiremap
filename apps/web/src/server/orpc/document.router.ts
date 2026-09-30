import { authed } from "../import.js";

// Three lines per procedure, as `RoleRouter`. `search` maps a domain array onto the
// contract's `{ hits }`, which is the transport's shape and not the domain's.
export class DocumentRouter {
  private constructor() {}

  public static readonly index = authed.document.index.handler(({ input, context }) =>
    context.container.ai.queueIndex.execute(context.principal, input),
  );

  public static readonly search = authed.document.search.handler(async ({ input, context }) => {
    const hits = await context.container.ai.searchDocuments.execute(context.principal, input);
    return { hits };
  });

  // The object the merge point in `app.router.ts` mounts, mirroring
  // `DocumentProcedures.all`.
  public static readonly all = {
    index: DocumentRouter.index,
    search: DocumentRouter.search,
  } as const;
}
