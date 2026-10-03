import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";
import { GraphContract } from "./graph.contract.js";

// The scan to read: the latest that succeeded unless one is named. Optional, not nullable,
// because these are GET routes in the public API, where an absent query parameter is undefined.
const scope = z.object({
  projectId: Identifiers.projectId,
  scanId: Identifiers.scanId.optional(),
});

const reached = z.object({ path: z.string(), depth: z.number().int().nonnegative() });

// Server-side reads of a graph, for callers that should not download and parse the whole
// file: the public API, the MCP server and the editor extension.
export class GraphQueryContract {
  private constructor() {}

  public static readonly scope = scope;

  public static readonly impactInput = scope.extend({
    path: z.string().min(1).max(1_024),
  });

  public static readonly routes = z.object({
    scanId: Identifiers.scanId,
    routes: z.array(GraphContract.route).readonly(),
  });

  public static readonly insights = z.object({
    scanId: Identifiers.scanId,
    files: z.number().int().nonnegative(),
    coverage: GraphContract.document.shape.coverage,
    insights: GraphContract.document.shape.insights,
  });

  public static readonly impact = z.object({
    scanId: Identifiers.scanId,
    path: z.string(),
    dependents: z.array(reached).readonly(),
    routes: z.array(GraphContract.route).readonly(),
  });
}

export type GraphScopeInput = z.infer<typeof GraphQueryContract.scope>;
export type GraphImpactInput = z.infer<typeof GraphQueryContract.impactInput>;
export type GraphRoutesDto = z.infer<typeof GraphQueryContract.routes>;
export type GraphInsightsDto = z.infer<typeof GraphQueryContract.insights>;
export type GraphImpactDto = z.infer<typeof GraphQueryContract.impact>;
