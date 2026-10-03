import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { GRAPH_VERSION, type GraphDocument } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { FileFacts } from "../../src/extension/file-facts.js";
import { GraphSource } from "../../src/extension/graph-source.js";

const file = (path: string, role: GraphDocument["files"][number]["role"]) => ({
  path,
  repository: "acme/api",
  language: "typescript" as const,
  role,
  loc: 10,
  exports: [],
});

const DOC: GraphDocument = {
  version: GRAPH_VERSION,
  meta: {
    analyzer: "t",
    generatedAt: "2026-10-03T00:00:00.000Z",
    repositories: [{ name: "acme/api", commit: null, branch: null }],
    timings: { totalMs: 1 },
  },
  languages: [],
  frameworks: [],
  files: [
    file("src/user.service.ts", "service"),
    file("src/user.controller.ts", "controller"),
    file("src/app.module.ts", "module"),
  ],
  edges: [
    { from: "src/user.controller.ts", to: "src/user.service.ts", kind: "import", certain: true },
    { from: "src/app.module.ts", to: "src/user.controller.ts", kind: "import", certain: true },
  ],
  unresolved: [],
  coverage: { resolved: 2, total: 2 },
  routes: [
    {
      id: "GET /users",
      method: "GET",
      path: "/users",
      file: "src/user.controller.ts",
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
    unguardedRoutes: [],
  },
};

describe("FileFacts", () => {
  const facts = new FileFacts(DOC);

  it("maps an open file to the graph's path, and nothing outside the folder", () => {
    expect(facts.pathOf("/work/api", "/work/api/src/user.service.ts")).toBe("src/user.service.ts");
    expect(facts.pathOf("/work/api", "/work/api/src/missing.ts")).toBeNull();
    expect(facts.pathOf("/work/api", "/work/other/src/user.service.ts")).toBeNull();
  });

  it("gives a file's role, both directions of imports, and its routes", () => {
    expect(facts.of("src/user.controller.ts")).toMatchObject({
      role: "controller",
      imports: ["src/user.service.ts"],
      importers: ["src/app.module.ts"],
      routes: [{ id: "GET /users" }],
    });
  });

  it("reaches every dependent and the routes among them", () => {
    const impact = facts.impact("src/user.service.ts");
    expect(impact.dependents).toEqual([
      { path: "src/user.controller.ts", depth: 1 },
      { path: "src/app.module.ts", depth: 2 },
    ]);
    expect(impact.routes.map((route) => route.id)).toEqual(["GET /users"]);
  });
});

describe("GraphSource", () => {
  it("prefers the local file, gzipped or not", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiremap-vscode-"));
    await writeFile(join(root, "graph.json.gz"), gzipSync(JSON.stringify(DOC)));
    const loaded = await new GraphSource(() => Promise.reject(new Error("no network"))).load({
      workspaceRoot: root,
      graphFile: "graph.json.gz",
      server: "https://wm.test",
      project: "api",
      apiKey: "k",
    });
    expect("document" in loaded && loaded.document.files).toHaveLength(3);
  });

  it("reads the project's latest scan when there is no file, by key", async () => {
    const asked: string[] = [];
    const http = (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push(`${String(url)} ${new Headers(init?.headers).get("authorization") ?? "-"}`);
      if (String(url).endsWith("/projects/by-slug/api")) return Response.json({ id: "p1" });
      if (String(url).endsWith("/projects/p1/graph"))
        return Response.json({ url: "https://s3.test/g" });
      return new Response(gzipSync(JSON.stringify(DOC)));
    }) as typeof fetch;
    const loaded = await new GraphSource(http).load({
      workspaceRoot: "/nowhere",
      graphFile: "graph.json",
      server: "https://wm.test/",
      project: "api",
      apiKey: "k",
    });

    expect("origin" in loaded && loaded.origin).toBe("api on https://wm.test/");
    expect(asked).toEqual([
      "https://wm.test/api/v1/projects/by-slug/api Bearer k",
      "https://wm.test/api/v1/projects/p1/graph Bearer k",
      // The signed URL carries its own authority; the key never goes to storage.
      "https://s3.test/g -",
    ]);
  });

  it("says what is missing rather than guessing", async () => {
    const loaded = await new GraphSource().load({
      workspaceRoot: "/nowhere",
      graphFile: "graph.json",
      server: "",
      project: "",
      apiKey: null,
    });
    expect(loaded).toEqual({
      missing: "no graph file, and no wiremap.server and wiremap.project set",
    });
  });
});
