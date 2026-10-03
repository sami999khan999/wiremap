import { oc } from "../import.js";
import { GraphQueryContract } from "./graph-query.contract.js";

export class GraphProcedures {
  private constructor() {}

  public static readonly routes = oc
    .route({ method: "GET", path: "/projects/{projectId}/routes" })
    .input(GraphQueryContract.scope)
    .output(GraphQueryContract.routes);

  public static readonly insights = oc
    .route({ method: "GET", path: "/projects/{projectId}/insights" })
    .input(GraphQueryContract.scope)
    .output(GraphQueryContract.insights);

  public static readonly impact = oc
    .route({ method: "GET", path: "/projects/{projectId}/impact" })
    .input(GraphQueryContract.impactInput)
    .output(GraphQueryContract.impact);

  public static readonly all = {
    routes: GraphProcedures.routes,
    insights: GraphProcedures.insights,
    impact: GraphProcedures.impact,
  } as const;
}
