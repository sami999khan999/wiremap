import { authed } from "../import.js";

export class ScanRouter {
  private constructor() {}

  public static readonly list = authed.scan.list.handler(async ({ input, context }) => ({
    ...(await context.container.scans.list.execute(context.principal, input)),
    limit: input.limit,
    offset: input.offset,
  }));

  public static readonly run = authed.scan.run.handler(({ input, context }) =>
    context.container.scans.run.execute(context.principal, input),
  );

  public static readonly createUpload = authed.scan.createUpload.handler(({ input, context }) =>
    context.container.scans.createUpload.execute(context.principal, input),
  );

  public static readonly graph = authed.scan.graph.handler(({ input, context }) =>
    context.container.scans.graph.execute(context.principal, input),
  );

  public static readonly all = {
    list: ScanRouter.list,
    run: ScanRouter.run,
    createUpload: ScanRouter.createUpload,
    graph: ScanRouter.graph,
  } as const;
}
