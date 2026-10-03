import { GRAPH_VERSION, type GraphDocument } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import {
  ExplorerLayout,
  ExplorerModel,
  type ExplorerState,
  ExplorerUrl,
} from "../../src/graph/index.js";

const file = (
  path: string,
  role: GraphDocument["files"][number]["role"],
  repository = "acme/api",
) => ({
  path,
  repository,
  language: "typescript" as const,
  role,
  loc: 10,
  exports: [],
});

const edge = (
  from: string,
  to: string,
  kind: "import" | "inject" | "api" = "import",
  certain = true,
) => ({
  from,
  to,
  kind,
  certain,
});

// users → shared twice, cats → shared once, users → cats once (inject), cats → users (api).
const DOC: GraphDocument = {
  version: GRAPH_VERSION,
  meta: {
    analyzer: "t",
    generatedAt: "2026-10-03T00:00:00.000Z",
    repositories: [{ name: "acme/api", commit: null, branch: null }],
    timings: { totalMs: 1 },
  },
  languages: [],
  frameworks: [{ id: "nestjs", repository: "acme/api" }],
  files: [
    file("src/users/users.controller.ts", "controller"),
    file("src/users/users.service.ts", "service"),
    file("src/cats/cats.service.ts", "service"),
    file("src/shared/db.ts", "utility"),
    file("main.ts", "source"),
  ],
  edges: [
    edge("src/users/users.controller.ts", "src/users/users.service.ts"),
    edge("src/users/users.service.ts", "src/shared/db.ts"),
    edge("src/users/users.controller.ts", "src/shared/db.ts"),
    edge("src/cats/cats.service.ts", "src/shared/db.ts", "import", false),
    edge("src/users/users.service.ts", "src/cats/cats.service.ts", "inject"),
    edge("main.ts", "src/users/users.controller.ts"),
  ],
  unresolved: [],
  coverage: { resolved: 6, total: 6 },
  routes: [],
  calls: [],
  insights: {
    mostDepended: [],
    cycles: [],
    unusedFiles: [],
    unusedExports: [],
    unguardedRoutes: [],
  },
};

const state = (change: Partial<ExplorerState> = {}): ExplorerState => ({
  ...ExplorerUrl.toState({}),
  ...change,
});

describe("ExplorerModel", () => {
  it("groups files into folders and counts the edges between them, each once per kind", () => {
    const view = ExplorerModel.build(DOC, state());

    expect(
      view.nodes.map((node) => `${node.id} ${node.files} in${node.in} out${node.out}`),
    ).toEqual([
      ". 1 in0 out1",
      "src/cats 1 in1 out1",
      "src/shared 1 in3 out0",
      "src/users 2 in1 out3",
    ]);
    const users = view.edges.find(
      (each) => each.source === "src/users" && each.target === "src/shared",
    );
    expect(users).toMatchObject({ kind: "import", count: 2, certain: true });
    expect(view.edges.find((each) => each.source === "src/cats")).toMatchObject({ certain: false });
    expect(view.nodes.find((node) => node.id === "src/users")?.badge).toBe("controller");
  });

  it("opens an expanded folder into its files, with their own edges", () => {
    const view = ExplorerModel.build(DOC, state({ expanded: new Set(["src/users"]) }));

    expect(view.nodes.filter((node) => node.kind === "file").map((node) => node.id)).toEqual([
      "src/users/users.controller.ts",
      "src/users/users.service.ts",
    ]);
    expect(view.edges.map((each) => `${each.kind} ${each.source} -> ${each.target}`)).toContain(
      "inject src/users/users.service.ts -> src/cats",
    );
    expect(view.nodes.find((node) => node.id === "src/users")?.expanded).toBe(true);
  });

  it("dims everything a role highlight or an impact does not reach", () => {
    const byRole = ExplorerModel.build(DOC, state({ role: "service" }));
    expect(byRole.nodes.filter((node) => node.dimmed).map((node) => node.id)).toEqual([
      ".",
      "src/shared",
    ]);
    expect(byRole.roles[0]).toEqual({ role: "service", count: 2 });

    const impact = ExplorerModel.build(
      DOC,
      state({ expanded: new Set(["src/shared"]), selected: "src/shared/db.ts", impact: true }),
    );
    expect(impact.nodes.find((node) => node.id === "src/shared/db.ts")?.impactDepth).toBe(0);
    expect(impact.nodes.find((node) => node.id === ".")?.dimmed).toBe(false);
  });

  it("filters by folder and repository", () => {
    expect(
      ExplorerModel.build(DOC, state({ folder: "src" })).nodes.map((node) => node.id),
    ).not.toContain(".");
    expect(ExplorerModel.build(DOC, state({ repository: "acme/web" })).nodes).toEqual([]);
  });

  it("builds a 5,000-file graph's view inside the budget", () => {
    const files = Array.from({ length: 5_000 }, (_, i) =>
      file(`src/m${i % 100}/f${i}.ts`, "service"),
    );
    const edges = files.flatMap((each, i) => [
      edge(each.path, files[(i * 7 + 1) % 5_000]?.path ?? each.path),
      edge(each.path, files[(i * 13 + 5) % 5_000]?.path ?? each.path),
    ]);
    const big: GraphDocument = { ...DOC, files, edges };
    const started = performance.now();
    const view = ExplorerModel.build(big, state({ expanded: new Set(["src/m1", "src/m2"]) }));
    const elapsed = performance.now() - started;

    expect(view.nodes.filter((node) => node.kind === "folder")).toHaveLength(100);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("ExplorerUrl", () => {
  it("round-trips a state, and leaves defaults out of the URL", () => {
    const original = state({
      depth: 3,
      expanded: new Set(["src/b", "src/a"]),
      role: "service",
      selected: "src/a/x.ts",
      impact: true,
    });
    const search = ExplorerUrl.toSearch(original);

    expect(search).toEqual({
      depth: 3,
      open: "src/a,src/b",
      role: "service",
      sel: "src/a/x.ts",
      impact: true,
    });
    expect(ExplorerUrl.toState(search)).toEqual(original);
    expect(ExplorerUrl.toSearch(state())).toEqual({});
  });
});

describe("ExplorerLayout", () => {
  it("nests an expanded folder's files in ELK and in the grid", () => {
    const view = ExplorerModel.build(DOC, state({ expanded: new Set(["src/users"]) }));
    const elk = ExplorerLayout.toElk(view);
    const users = elk.children?.find((child) => child.id === "src/users");

    expect(users?.children?.map((child) => child.id)).toEqual([
      "src/users/users.controller.ts",
      "src/users/users.service.ts",
    ]);
    expect(elk.edges?.length).toBe(view.edges.length);
    const grid = ExplorerLayout.grid(view);
    expect(grid.get("src/users/users.service.ts")?.y).toBeGreaterThan(
      grid.get("src/users/users.controller.ts")?.y ?? 0,
    );
    expect(
      ExplorerLayout.positions({
        id: "root",
        children: [{ id: "a", x: 5, y: 6, width: 7, height: 8 }],
      }).get("a"),
    ).toEqual({ x: 5, y: 6, width: 7, height: 8 });
  });
});
