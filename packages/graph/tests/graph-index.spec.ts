import { describe, expect, it } from "vitest";
import { GraphDiff, GraphIndex, type GraphInput } from "../src/index.js";

const graph = (paths: string[], pairs: [string, string, string[]?][]): GraphInput => ({
  files: paths.map((path) => ({ path })),
  edges: pairs.map(([from, to, names]) => ({
    from,
    to,
    kind: "import" as const,
    ...(names ? { names } : {}),
  })),
});

// main → app → (users, cats); users ↔ auth (a cycle); cats → shared; util is unreferenced.
const SAMPLE = graph(
  [
    "src/main.ts",
    "src/app.module.ts",
    "src/users/users.service.ts",
    "src/auth/auth.service.ts",
    "src/cats/cats.service.ts",
    "src/shared/db.ts",
    "src/shared/util.ts",
  ],
  [
    ["src/main.ts", "src/app.module.ts", ["AppModule"]],
    ["src/app.module.ts", "src/users/users.service.ts", ["UsersService"]],
    ["src/app.module.ts", "src/cats/cats.service.ts", ["CatsService"]],
    ["src/users/users.service.ts", "src/auth/auth.service.ts", ["AuthService"]],
    ["src/auth/auth.service.ts", "src/users/users.service.ts", ["UsersService"]],
    ["src/cats/cats.service.ts", "src/shared/db.ts", ["db"]],
    ["src/users/users.service.ts", "src/shared/db.ts", ["db"]],
    ["src/users/users.service.ts", "src/shared/db.ts", ["db"]],
    ["src/main.ts", "node_modules/@nestjs/core/index.js"],
  ],
);

describe("GraphIndex", () => {
  const index = GraphIndex.from(SAMPLE);

  it("walks both ways, nearest first, to a depth, dropping duplicates and unknown targets", () => {
    expect(index.imports("src/main.ts")).toEqual(["src/app.module.ts"]);
    expect(index.importers("src/shared/db.ts")).toEqual([
      "src/cats/cats.service.ts",
      "src/users/users.service.ts",
    ]);
    expect(index.dependencies("src/main.ts", 1).map((each) => each.path)).toEqual([
      "src/app.module.ts",
    ]);
    expect(index.dependents("src/shared/db.ts")).toEqual([
      { path: "src/cats/cats.service.ts", depth: 1 },
      { path: "src/users/users.service.ts", depth: 1 },
      { path: "src/app.module.ts", depth: 2 },
      { path: "src/auth/auth.service.ts", depth: 2 },
      { path: "src/main.ts", depth: 3 },
    ]);
    expect(index.dependents("nope.ts")).toEqual([]);
  });

  it("finds cycles, including a file importing itself", () => {
    expect(index.cycles()).toEqual([["src/auth/auth.service.ts", "src/users/users.service.ts"]]);
    const self = GraphIndex.from(graph(["a.ts"], [["a.ts", "a.ts"]]));
    expect(self.cycles()).toEqual([["a.ts"]]);
  });

  it("ranks the most depended-on, and finds unused files and exports from the entries", () => {
    expect(index.mostDepended(1)).toEqual([{ path: "src/shared/db.ts", dependents: 2 }]);
    expect(index.unusedFiles(["src/main.ts"])).toEqual(["src/shared/util.ts"]);
    expect(
      index.unusedExports(
        [
          { path: "src/shared/db.ts", exports: ["db", "migrate"] },
          { path: "src/main.ts", exports: ["bootstrap"] },
        ],
        new Set(["src/main.ts"]),
      ),
    ).toEqual([{ path: "src/shared/db.ts", name: "migrate" }]);
  });

  it("aggregates folders at a depth, counting only edges that cross them", () => {
    const { nodes, edges } = index.folders(2);
    expect(nodes.find((node) => node.id === "src/shared")).toEqual({
      id: "src/shared",
      files: 2,
      in: 2,
      out: 0,
    });
    expect(edges).toContainEqual({ from: "src/users", to: "src/shared", count: 1 });
    expect(GraphIndex.folderOf("README.md", 2)).toBe(".");
    expect(GraphIndex.folderOf("src/main.ts", 2)).toBe("src");
  });
});

describe("GraphDiff", () => {
  it("reports files, edges, routes and cycles added and removed", () => {
    const before = { ...SAMPLE, routes: [] };
    const after = {
      files: [
        ...SAMPLE.files.filter((file) => file.path !== "src/shared/util.ts"),
        { path: "src/new.ts" },
      ],
      edges: SAMPLE.edges.filter((edge) => edge.from !== "src/auth/auth.service.ts"),
      routes: [{ id: "GET /cats" }],
    };

    const changes = GraphDiff.between(before as never, after as never);

    expect(changes.files).toEqual({ added: ["src/new.ts"], removed: ["src/shared/util.ts"] });
    expect(changes.edges.removed).toEqual([
      { from: "src/auth/auth.service.ts", to: "src/users/users.service.ts", kind: "import" },
    ]);
    expect(changes.routes.added).toEqual(["GET /cats"]);
    expect(changes.cycles.fixed).toHaveLength(1);
    expect(changes.cycles.introduced).toEqual([]);
  });
});
