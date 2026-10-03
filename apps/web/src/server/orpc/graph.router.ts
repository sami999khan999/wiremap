import { authed } from "../import.js";

export class GraphRouter {
  private constructor() {}

  public static readonly routes = authed.graph.routes.handler(({ input, context }) =>
    context.container.scans.query.routes(context.principal, input),
  );

  public static readonly insights = authed.graph.insights.handler(({ input, context }) =>
    context.container.scans.query.insights(context.principal, input),
  );

  public static readonly impact = authed.graph.impact.handler(({ input, context }) =>
    context.container.scans.query.impact(context.principal, input),
  );

  public static readonly all = {
    routes: GraphRouter.routes,
    insights: GraphRouter.insights,
    impact: GraphRouter.impact,
  } as const;
}
