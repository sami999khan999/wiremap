import { describe, expect, it } from "vitest";
import { ExplorerLayout } from "../../src/graph/explorer-layout.js";

describe("ExplorerLayout.routes", () => {
  it("reads every edge's route, offset by the node that contains it", () => {
    const routes = ExplorerLayout.routes({
      id: "root",
      children: [{ id: "src/a", x: 100, y: 50, children: [{ id: "src/a/x.ts", x: 10, y: 10 }] }],
      edges: [
        {
          id: "top",
          sources: ["p"],
          targets: ["q"],
          sections: [
            {
              id: "s1",
              startPoint: { x: 0, y: 0 },
              bendPoints: [{ x: 40, y: 0 }],
              endPoint: { x: 40, y: 30 },
            },
          ],
        },
        {
          id: "inner",
          sources: ["src/a/x.ts"],
          targets: ["src/a/y.ts"],
          container: "src/a",
          sections: [{ id: "s2", startPoint: { x: 5, y: 5 }, endPoint: { x: 25, y: 5 } }],
        } as never,
      ],
    });

    expect(routes.get("top")).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
    ]);
    expect(routes.get("inner")).toEqual([
      { x: 105, y: 55 },
      { x: 125, y: 55 },
    ]);
  });

  it("routes each edge on its own track rather than merging them", () => {
    const options = ExplorerLayout.toElk({ nodes: [], edges: [], roles: [] }).layoutOptions ?? {};

    expect(options["elk.edgeRouting"]).toBe("ORTHOGONAL");
    expect(options["elk.layered.mergeEdges"]).toBe("false");
    expect(options["elk.layered.wrapping.strategy"]).toBeUndefined();
  });
});
