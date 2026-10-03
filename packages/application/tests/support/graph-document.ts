import { GRAPH_VERSION, type GraphDocument } from "@loadbearing/contracts";

const file = (
  path: string,
  role: GraphDocument["files"][number]["role"],
  exports: string[] = [],
) => ({
  path,
  repository: "acme/api",
  language: "typescript" as const,
  role,
  loc: 20,
  exports,
});

export const GRAPH_DOC: GraphDocument = {
  version: GRAPH_VERSION,
  meta: {
    analyzer: "t",
    generatedAt: "2026-10-03T00:00:00.000Z",
    repositories: [{ name: "acme/api", commit: "abc123", branch: "main" }],
    timings: { totalMs: 1 },
  },
  languages: [],
  frameworks: [{ id: "nestjs", repository: "acme/api" }],
  files: [
    file("src/user/user.service.ts", "service", ["UserService"]),
    file("src/user/user.controller.ts", "controller", ["UserController"]),
    file("src/shared/db.ts", "utility", ["db"]),
  ],
  edges: [
    {
      from: "src/user/user.controller.ts",
      to: "src/user/user.service.ts",
      kind: "import",
      certain: true,
    },
  ],
  unresolved: [],
  coverage: { resolved: 1, total: 1 },
  routes: [
    {
      id: "GET /user",
      method: "GET",
      path: "/user",
      file: "src/user/user.controller.ts",
      line: 9,
      framework: "nestjs",
      guards: [],
      source: "static",
    },
  ],
  calls: [],
  insights: {
    mostDepended: [{ path: "src/user/user.service.ts", dependents: 1 }],
    cycles: [],
    unusedFiles: [],
    unusedExports: [],
    unguardedRoutes: ["GET /user"],
  },
};
