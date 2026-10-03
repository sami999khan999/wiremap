import {
  type FileRole,
  type GraphDocument,
  type GraphEdge,
  type GraphFile,
  GraphIndex,
  type GraphRoute,
} from "../import.js";

// Roles a framework or a tool consumes by convention, so "nothing imports it" is expected.
const CONSUMED: ReadonlySet<FileRole> = new Set(["test", "config", "migration", "view", "types"]);

// What the overview shows at a glance, computed once at scan time over the import graph.
export class InsightBuilder {
  private constructor() {}

  public static build(
    files: readonly GraphFile[],
    edges: readonly GraphEdge[],
    routes: readonly GraphRoute[],
    entries: ReadonlySet<string>,
    // Only files in a package with at least one known entry can be called unused.
    judged: ReadonlySet<string>,
  ): GraphDocument["insights"] {
    const imports = GraphIndex.from({
      files,
      edges: edges.filter((edge) => edge.kind === "import"),
    });
    const reach = GraphIndex.from({ files, edges });
    const role = new Map(files.map((file) => [file.path, file.role]));
    const unusedFiles = reach
      .unusedFiles(entries)
      .filter((path) => judged.has(path) && !CONSUMED.has(role.get(path) ?? "source"));
    const unused = new Set(unusedFiles);
    return {
      mostDepended: imports
        .mostDepended(10)
        .map((entry) => ({ path: entry.path, dependents: entry.dependents })),
      cycles: imports
        .cycles()
        .slice(0, 1_000)
        .map((cycle) => [...cycle].slice(0, 500)),
      unusedFiles,
      unusedExports: reach
        .unusedExports(
          files.filter(
            (file) => judged.has(file.path) && !unused.has(file.path) && !CONSUMED.has(file.role),
          ),
          entries,
        )
        .map((entry) => ({ path: entry.path, name: entry.name })),
      unguardedRoutes: routes
        .filter(
          (route) =>
            route.guards.length === 0 && route.method !== "OPTIONS" && route.method !== "HEAD",
        )
        .map((route) => route.id),
    };
  }
}
