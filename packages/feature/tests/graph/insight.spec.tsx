import { GRAPH_VERSION, type GraphDocument } from "@loadbearing/contracts";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompareView, ImpactExplorer, InsightsOverview } from "../../src/insight/index.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const file = (path: string) => ({
  path,
  repository: "a/b",
  language: "typescript" as const,
  role: "service" as const,
  loc: 1,
  exports: [],
});
const edge = (from: string, to: string) => ({ from, to, kind: "import" as const, certain: true });

const doc = (paths: string[], edges: [string, string][], routes: string[] = []): GraphDocument => ({
  version: GRAPH_VERSION,
  meta: {
    analyzer: "t",
    generatedAt: "2026-10-03T00:00:00.000Z",
    repositories: [{ name: "a/b", commit: null, branch: null }],
    timings: { totalMs: 1 },
  },
  languages: [],
  frameworks: [],
  files: paths.map(file),
  edges: edges.map(([from, to]) => edge(from, to)),
  unresolved: [],
  coverage: { resolved: 0, total: 0 },
  routes: routes.map((id) => {
    const [method, path] = id.split(" ") as ["GET", string];
    return {
      id,
      method,
      path,
      file: "api.ts",
      line: 3,
      framework: "nestjs" as const,
      guards: [],
      source: "static" as const,
    };
  }),
  calls: [],
  insights: {
    mostDepended: [{ path: "db.ts", dependents: 2 }],
    cycles: [["a.ts", "b.ts"]],
    unusedFiles: ["old.ts"],
    unusedExports: [{ path: "db.ts", name: "migrate" }],
    unguardedRoutes: routes,
  },
});

const link = (path: string, content: React.ReactNode) => <a href={`#${path}`}>{content}</a>;
const render = (node: React.ReactElement) =>
  renderWithFakes(node, capabilitiesWith([]), undefined, ["graph", "common"]);

describe("InsightsOverview", () => {
  it("lists each insight, its paths linking into the graph", async () => {
    await render(
      <InsightsOverview
        document={doc(["db.ts", "a.ts", "b.ts"], [], ["GET /users"])}
        renderPath={link}
      />,
    );

    expect(screen.getByText("Most depended on")).toBeDefined();
    expect(screen.getAllByText("db.ts")[0]?.closest("a")?.getAttribute("href")).toBe("#db.ts");
    expect(screen.getByText("old.ts")).toBeDefined();
    expect(screen.getByText("migrate")).toBeDefined();
    expect(screen.getByText("GET /users")).toBeDefined();
  });
});

describe("ImpactExplorer", () => {
  it("names what depends on the file by distance, and the routes it reaches", async () => {
    const onPath = vi.fn();
    await render(
      <ImpactExplorer
        document={doc(
          ["db.ts", "repo.ts", "api.ts"],
          [
            ["repo.ts", "db.ts"],
            ["api.ts", "repo.ts"],
          ],
          ["GET /users"],
        )}
        path="db.ts"
        onPath={onPath}
        renderPath={link}
      />,
    );

    expect(screen.getByText("2 files depend on db.ts")).toBeDefined();
    expect(screen.getByText("1 files at distance 2")).toBeDefined();
    expect(screen.getByText("/users")).toBeDefined();
    fireEvent.change(screen.getByLabelText("File"), { target: { value: "repo.ts" } });
    expect(onPath).toHaveBeenCalledWith("repo.ts");
  });
});

describe("CompareView", () => {
  it("shows files and routes that came and went, and a cycle that was fixed", async () => {
    const before = doc(
      ["a.ts", "b.ts", "gone.ts"],
      [
        ["a.ts", "b.ts"],
        ["b.ts", "a.ts"],
      ],
      ["GET /old"],
    );
    const after = doc(["a.ts", "b.ts", "new.ts"], [["a.ts", "b.ts"]], ["GET /new"]);
    await render(<CompareView before={before} after={after} renderPath={link} />);

    expect(screen.getByText("new.ts")).toBeDefined();
    expect(screen.getByText("gone.ts")).toBeDefined();
    expect(screen.getByText("GET /new")).toBeDefined();
    expect(screen.getByText("a.ts → b.ts")).toBeDefined();
  });
});
