import { describe, expect, it } from "vitest";
import { GRAPH_VERSION, GraphContract, type GraphDocument } from "../../src/graph/index.js";

const minimal = (): GraphDocument => ({
  version: GRAPH_VERSION,
  meta: {
    analyzer: "0.1.0",
    generatedAt: "2026-10-03T00:00:00.000Z",
    repositories: [{ name: "acme/api", commit: "abc123", branch: "main" }],
    timings: { totalMs: 12 },
  },
  languages: [{ id: "typescript", files: 2 }],
  frameworks: [{ id: "nestjs", repository: "acme/api" }],
  files: [
    {
      path: "src/app.module.ts",
      repository: "acme/api",
      language: "typescript",
      role: "module",
      loc: 10,
      exports: ["AppModule"],
    },
    {
      path: "src/cats/cats.service.ts",
      repository: "acme/api",
      language: "typescript",
      role: "service",
      loc: 20,
      exports: ["CatsService"],
    },
  ],
  edges: [
    {
      from: "src/app.module.ts",
      to: "src/cats/cats.service.ts",
      kind: "import",
      certain: true,
      names: ["CatsService"],
    },
  ],
  unresolved: [],
  coverage: { resolved: 1, total: 1 },
  routes: [
    {
      id: "GET /cats",
      method: "GET",
      path: "/cats",
      file: "src/cats/cats.controller.ts",
      line: 7,
      framework: "nestjs",
      guards: [],
      source: "static",
    },
  ],
  calls: [],
  insights: {
    mostDepended: [],
    cycles: [],
    unusedFiles: [],
    unusedExports: [],
    unguardedRoutes: ["GET /cats"],
  },
});

describe("GraphContract.document", () => {
  it("parses a version-1 document", () => {
    expect(GraphContract.document.parse(minimal()).files).toHaveLength(2);
  });

  it("refuses another version, an unknown role and an empty repository list", () => {
    const parse = (doc: unknown) => GraphContract.document.safeParse(doc).success;
    expect(parse({ ...minimal(), version: 2 })).toBe(false);
    const doc = minimal();
    expect(parse({ ...doc, files: [{ ...doc.files[0], role: "wizard" }] })).toBe(false);
    expect(parse({ ...doc, meta: { ...doc.meta, repositories: [] } })).toBe(false);
  });
});
