import { fileURLToPath } from "node:url";
import { GraphContract, type GraphDocument } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { Analyzer } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixture/${name}`, import.meta.url));

// Fixed time and a zero timing, so the golden file changes only when the analysis does.
const analyze = async (name: string): Promise<GraphDocument> => {
  const doc = await Analyzer.run({
    repositories: [{ name: `acme/${name}`, root: fixture(name), commit: "abc123", branch: "main" }],
    version: "test",
    now: () => new Date("2026-10-03T00:00:00.000Z"),
  });
  return GraphContract.document.parse({ ...doc, meta: { ...doc.meta, timings: { totalMs: 0 } } });
};

const routesOf = (doc: GraphDocument) =>
  doc.routes.map((route) => `${route.id} ${route.file}:${route.line} [${route.guards.join(",")}]`);

describe("Analyzer on NestJS", () => {
  it("finds every route under the global prefix, with its guards, injections and insights", async () => {
    const doc = await analyze("nestjs");

    expect(routesOf(doc)).toEqual([
      "GET /api/articles src/article/article.controller.ts:9 []",
      "GET /api/articles/:slug src/article/article.controller.ts:14 []",
      "POST /api/articles src/article/article.controller.ts:20 [AuthGuard]",
      "DELETE /api/articles/:slug src/article/article.controller.ts:25 [AuthMiddleware]",
      "GET /api/user src/user/user.controller.ts:9 [AuthGuard]",
      "PUT /api/user src/user/user.controller.ts:15 [AuthGuard]",
      "POST /api/users src/user/user.controller.ts:21 []",
      "POST /api/users/login src/user/user.controller.ts:26 []",
    ]);
    expect(doc.edges).toContainEqual({
      from: "src/user/user.service.ts",
      to: "src/user/user.entity.ts",
      kind: "inject",
      certain: true,
    });
    expect(doc.files.find((file) => file.path === "src/user/auth.guard.ts")?.role).toBe("guard");
    expect(doc.coverage).toEqual({ resolved: 18, total: 18 });
    expect(doc.files.find((file) => file.path === "src/user/auth.middleware.ts")?.role).toBe(
      "middleware",
    );
    expect(doc.insights.cycles).toEqual([["src/shared/slug.ts", "src/shared/text.ts"]]);
    expect(doc.insights.unusedFiles).toEqual(["src/legacy/old.ts"]);
    expect(doc.insights.unusedExports).toEqual([{ path: "src/shared/slug.ts", name: "unslug" }]);
    await expect(JSON.stringify(doc, null, 2)).toMatchFileSnapshot("./golden/nestjs.json");
  });
});

describe("Analyzer on Next.js", () => {
  it("reads route handlers, the middleware matcher and the frontend's calls", async () => {
    const doc = await analyze("nextjs");

    expect(routesOf(doc)).toEqual([
      "GET /api/users/:id app/api/users/[id]/route.ts:1 [middleware]",
      "DELETE /api/users/:id app/api/users/[id]/route.ts:5 [middleware]",
      "GET /api/users app/api/users/route.ts:3 [middleware]",
      "POST /api/users app/api/users/route.ts:7 [middleware]",
    ]);
    expect(doc.calls.map((call) => [call.url, call.route, call.certain])).toEqual([
      ["/api/users", "GET /api/users", true],
      ["/api/users/:param", "DELETE /api/users/:id", false],
      ["/health", null, false],
    ]);
    expect(doc.edges).toContainEqual({
      from: "components/UserList.tsx",
      to: "app/api/users/route.ts",
      kind: "api",
      certain: true,
    });
    expect(doc.files.find((file) => file.path === "app/(marketing)/about/page.tsx")?.role).toBe(
      "page",
    );
    await expect(JSON.stringify(doc, null, 2)).toMatchFileSnapshot("./golden/nextjs.json");
  });
});

describe("Analyzer on TanStack Start", () => {
  it("finds server handlers on file routes, and their middleware", async () => {
    const doc = await analyze("tanstack");

    expect(routesOf(doc)).toEqual([
      "GET /api/users src/routes/api/users.ts:8 [authMiddleware]",
      "POST /api/users src/routes/api/users.ts:9 [authMiddleware]",
    ]);
    expect(doc.frameworks.map((framework) => framework.id)).toEqual(["tanstack-start", "react"]);
    await expect(JSON.stringify(doc, null, 2)).toMatchFileSnapshot("./golden/tanstack.json");
  });
});

describe("Analyzer on Laravel", () => {
  it("reads routes files through groups, resources and middleware, to the controller method", async () => {
    const doc = await analyze("laravel");

    expect(routesOf(doc)).toEqual([
      "GET /api/users app/Http/Controllers/UserController.php:9 []",
      "POST /api/users app/Http/Controllers/UserController.php:14 [auth:sanctum]",
      "GET /api/posts app/Http/Controllers/PostController.php:9 [auth:sanctum]",
      "POST /api/posts app/Http/Controllers/PostController.php:19 [auth:sanctum]",
      "GET /api/posts/:id app/Http/Controllers/PostController.php:14 [auth:sanctum]",
      "DELETE /api/admin/users/:user app/Http/Controllers/UserController.php:19 [auth,can:admin]",
      "GET / routes/web.php:5 []",
    ]);
    expect(doc.edges).toContainEqual({
      from: "app/Models/User.php",
      to: "app/Models/Post.php",
      kind: "import",
      certain: true,
      names: ["Post"],
    });
    expect(doc.insights.unusedFiles).toEqual(["app/Http/Middleware/Unused.php"]);
    await expect(JSON.stringify(doc, null, 2)).toMatchFileSnapshot("./golden/laravel.json");
  });
});

describe("Analyzer on a pnpm monorepo", () => {
  it("maps workspace packages to their source and reports what did not resolve", async () => {
    const doc = await analyze("monorepo");

    expect(doc.edges.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      "apps/web/src/index.ts -> packages/shared/src/index.ts",
      "apps/web/src/index.ts -> packages/shared/src/format.ts",
      "packages/shared/src/index.ts -> packages/shared/src/format.ts",
    ]);
    expect(doc.unresolved).toEqual([{ from: "apps/web/src/index.ts", specifier: "./missing" }]);
    expect(doc.coverage).toEqual({ resolved: 3, total: 4 });
    await expect(JSON.stringify(doc, null, 2)).toMatchFileSnapshot("./golden/monorepo.json");
  });
});

describe("Analyzer across repositories", () => {
  it("prefixes every path with its repository and matches a call across them", async () => {
    const doc = await Analyzer.run({
      repositories: [
        { name: "acme/web", root: fixture("nextjs") },
        { name: "acme/api", root: fixture("nestjs") },
      ],
    });

    expect(
      doc.files.every((file) => file.path.startsWith("web/") || file.path.startsWith("api/")),
    ).toBe(true);
    expect(doc.routes.some((route) => route.file === "api/src/user/user.controller.ts")).toBe(true);
    expect(GraphContract.document.safeParse(doc).success).toBe(true);
  });
});
