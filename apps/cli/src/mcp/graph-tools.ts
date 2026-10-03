import { type GraphDocument, GraphIndex, type GraphRoute } from "../import.js";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

type Args = Readonly<Record<string, unknown>>;

const object = (properties: Record<string, unknown>, required: readonly string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const PATH = {
  type: "string",
  description: "A file path as the graph names it, e.g. src/user/user.service.ts",
};
const DEPTH = { type: "integer", minimum: 1, description: "How many hops to follow. Default: all" };
const LIMIT = 200;

const TOOLS: readonly ToolDefinition[] = Object.freeze([
  {
    name: "overview",
    description:
      "What the project is: repositories, frameworks, file and import counts, routes, how much of the graph resolved, files by role, and the most depended-on files.",
    inputSchema: object({}),
  },
  {
    name: "find_files",
    description:
      "Find files whose path or exported names contain the text, optionally of one role (controller, service, page, ...).",
    inputSchema: object({ query: { type: "string" }, role: { type: "string" } }, ["query"]),
  },
  {
    name: "dependencies",
    description: "The files a file imports, directly and through them, with the distance of each.",
    inputSchema: object({ path: PATH, depth: DEPTH }, ["path"]),
  },
  {
    name: "dependents",
    description:
      "The files that import a file, directly and through them, with the distance of each.",
    inputSchema: object({ path: PATH, depth: DEPTH }, ["path"]),
  },
  {
    name: "impact",
    description:
      "What a change to a file can break: every file that depends on it, by distance, and the HTTP routes whose handler is among them.",
    inputSchema: object({ path: PATH }, ["path"]),
  },
  {
    name: "routes",
    description: "The HTTP routes the backend defines, with the file and line of each handler.",
    inputSchema: object({
      method: { type: "string", description: "GET, POST, ..." },
      contains: { type: "string", description: "Text the route's path contains" },
    }),
  },
  {
    name: "route_for_path",
    description:
      "Which route serves a concrete URL path such as /api/articles/42, and the handler's file and line.",
    inputSchema: object({ path: { type: "string" }, method: { type: "string" } }, ["path"]),
  },
  {
    name: "cycles",
    description: "Import cycles: groups of files that import each other round a loop.",
    inputSchema: object({}),
  },
]);

// The answers an assistant can ask of one graph. Pure over the document, so the same tools
// serve a local `graph.json` and one downloaded from a project.
export class GraphTools {
  private readonly index: GraphIndex;

  public constructor(private readonly document: GraphDocument) {
    this.index = GraphIndex.from(document);
  }

  public static readonly definitions = TOOLS;

  public call(name: string, args: Args): unknown {
    switch (name) {
      case "overview":
        return this.overview();
      case "find_files":
        return this.findFiles(GraphTools.text(args, "query"), GraphTools.optional(args, "role"));
      case "dependencies":
        return this.index.dependencies(this.file(args), GraphTools.depth(args)).slice(0, LIMIT);
      case "dependents":
        return this.index.dependents(this.file(args), GraphTools.depth(args)).slice(0, LIMIT);
      case "impact":
        return this.impact(this.file(args));
      case "routes":
        return this.routes(
          GraphTools.optional(args, "method"),
          GraphTools.optional(args, "contains"),
        );
      case "route_for_path":
        return this.routeFor(GraphTools.text(args, "path"), GraphTools.optional(args, "method"));
      case "cycles":
        return this.document.insights.cycles;
      default:
        throw new Error(`No tool named ${name}.`);
    }
  }

  private overview() {
    const roles = new Map<string, number>();
    for (const file of this.document.files) roles.set(file.role, (roles.get(file.role) ?? 0) + 1);
    const { resolved, total } = this.document.coverage;
    return {
      repositories: this.document.meta.repositories.map((repository) => repository.name),
      frameworks: [...new Set(this.document.frameworks.map((framework) => framework.id))],
      files: this.document.files.length,
      importsBetweenFiles: this.document.edges.filter((edge) => edge.kind === "import").length,
      routes: this.document.routes.length,
      resolved: `${resolved} of ${total} imports into the repository resolved`,
      roles: Object.fromEntries([...roles].sort((a, b) => b[1] - a[1])),
      mostDepended: this.document.insights.mostDepended.slice(0, 10),
      cycles: this.document.insights.cycles.length,
      unguardedRoutes: this.document.insights.unguardedRoutes.length,
    };
  }

  private findFiles(query: string, role: string | null) {
    const needle = query.toLowerCase();
    return this.document.files
      .filter((file) => !role || file.role === role)
      .filter(
        (file) =>
          file.path.toLowerCase().includes(needle) ||
          file.exports.some((name) => name.toLowerCase().includes(needle)),
      )
      .slice(0, LIMIT)
      .map((file) => ({ path: file.path, role: file.role, exports: file.exports }));
  }

  private impact(path: string) {
    const dependents = this.index.impact(path);
    const touched = new Set([path, ...dependents.map((reached) => reached.path)]);
    return {
      path,
      dependents: dependents.slice(0, LIMIT),
      routes: this.document.routes
        .filter((route) => touched.has(route.file))
        .map((route) => GraphTools.route(route)),
    };
  }

  private routes(method: string | null, contains: string | null) {
    return this.document.routes
      .filter((route) => !method || route.method === method.toUpperCase())
      .filter((route) => !contains || route.path.includes(contains))
      .slice(0, LIMIT)
      .map((route) => GraphTools.route(route));
  }

  // A route's pattern against a concrete path: `:id`, `{id}` and `[id]` each take one segment.
  private routeFor(path: string, method: string | null) {
    const wanted = GraphTools.segments(path);
    return this.document.routes
      .filter((route) => !method || route.method === method.toUpperCase() || route.method === "ANY")
      .filter((route) => {
        const pattern = GraphTools.segments(route.path);
        return (
          pattern.length === wanted.length &&
          pattern.every((part, at) => /^(:|\{|\[)/.test(part) || part === wanted[at])
        );
      })
      .map((route) => GraphTools.route(route));
  }

  private file(args: Args): string {
    const path = GraphTools.text(args, "path");
    if (!this.index.has(path))
      throw new Error(`The graph has no file ${path}. Use find_files to look it up.`);
    return path;
  }

  private static route(route: GraphRoute) {
    return {
      method: route.method,
      path: route.path,
      handler: `${route.file}:${route.line}`,
      guards: route.guards,
    };
  }

  private static segments(path: string): readonly string[] {
    return path.split("?")[0]?.split("/").filter(Boolean) ?? [];
  }

  private static text(args: Args, name: string): string {
    const value = args[name];
    if (typeof value !== "string" || value === "") throw new Error(`${name} is required.`);
    return value;
  }

  private static optional(args: Args, name: string): string | null {
    const value = args[name];
    return typeof value === "string" && value !== "" ? value : null;
  }

  private static depth(args: Args): number | undefined {
    const value = args.depth;
    return typeof value === "number" && value >= 1 ? Math.floor(value) : undefined;
  }
}
