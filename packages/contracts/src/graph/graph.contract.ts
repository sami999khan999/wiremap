import { z } from "../import.js";

// Bumped on any change a version-1 reader would misread. A reader refuses what it does not
// know rather than guessing; the analyzer and the explorer ship from one commit.
export const GRAPH_VERSION = 1 as const;

export const GRAPH_LANGUAGES = ["typescript", "javascript", "php"] as const;
// `other` is a route an OpenAPI file declares in a repository with no framework detected.
export const GRAPH_FRAMEWORKS = [
  "nextjs",
  "tanstack-start",
  "nestjs",
  "laravel",
  "react",
  "other",
] as const;

// One closed list across frameworks; a framework shows the subset its files use.
export const FILE_ROLES = [
  "controller",
  "resolver",
  "gateway",
  "service",
  "repository",
  "entity",
  "dto",
  "module",
  "guard",
  "interceptor",
  "pipe",
  "filter",
  "middleware",
  "model",
  "page",
  "layout",
  "route",
  "api",
  "component",
  "hook",
  "job",
  "event",
  "policy",
  "request",
  "migration",
  "view",
  "utility",
  "test",
  "types",
  "config",
  "source",
] as const;

// `import` is a module reference; `inject` a constructor dependency a container resolves;
// `api` a frontend call reaching a backend route's handler file.
export const EDGE_KINDS = ["import", "inject", "api"] as const;

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "ANY",
] as const;

// Bounds that make a hostile upload expensive to refuse rather than expensive to accept.
const MANY = 200_000;
const path = z.string().min(1).max(1024);

const file = z.object({
  // Unique in the document. A multi-repository project prefixes each with its repository.
  path,
  repository: z.string().min(1).max(200),
  language: z.enum(GRAPH_LANGUAGES),
  role: z.enum(FILE_ROLES),
  loc: z.number().int().nonnegative(),
  exports: z.array(z.string().max(200)).max(2_000),
});

const edge = z.object({
  from: path,
  to: path,
  kind: z.enum(EDGE_KINDS),
  // False when the target was inferred: a template URL, a prefix match, a guessed alias.
  certain: z.boolean(),
  // The names imported, `*` for a namespace or side-effect import. Unused exports read it.
  names: z.array(z.string().max(200)).max(500).optional(),
});

const unresolved = z.object({
  from: path,
  specifier: z.string().max(1024),
});

const route = z.object({
  // `METHOD path`, unique in the document, so calls and insights can name a route.
  id: z.string().max(1100),
  method: z.enum(HTTP_METHODS),
  path: z.string().max(1024),
  file: path,
  line: z.number().int().positive(),
  framework: z.enum(GRAPH_FRAMEWORKS),
  guards: z.array(z.string().max(200)).max(50),
  source: z.enum(["static", "openapi", "artisan"]),
});

const call = z.object({
  file: path,
  line: z.number().int().positive(),
  method: z.enum(HTTP_METHODS),
  // Normalised: a template's placeholders become `:param`.
  url: z.string().max(1024),
  route: z.string().max(1100).nullable(),
  certain: z.boolean(),
});

export class GraphContract {
  private constructor() {}

  public static readonly file = file;
  public static readonly edge = edge;
  public static readonly route = route;
  public static readonly call = call;

  public static readonly document = z.object({
    version: z.literal(GRAPH_VERSION),
    meta: z.object({
      analyzer: z.string().max(50),
      generatedAt: z.iso.datetime(),
      repositories: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            commit: z.string().max(64).nullable(),
            branch: z.string().max(255).nullable(),
          }),
        )
        .min(1)
        .max(20),
      timings: z.object({ totalMs: z.number().nonnegative() }),
    }),
    languages: z
      .array(z.object({ id: z.enum(GRAPH_LANGUAGES), files: z.number().int().nonnegative() }))
      .max(GRAPH_LANGUAGES.length),
    frameworks: z
      .array(z.object({ id: z.enum(GRAPH_FRAMEWORKS), repository: z.string().max(200) }))
      .max(50),
    files: z.array(file).max(MANY),
    edges: z.array(edge).max(MANY * 5),
    unresolved: z.array(unresolved).max(MANY),
    // Imports that point inside a repository, and how many of them resolved to a file: what
    // the "graph is partial" banner reports. Package imports count in neither.
    coverage: z.object({
      resolved: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    routes: z.array(route).max(MANY),
    calls: z.array(call).max(MANY),
    insights: z.object({
      mostDepended: z
        .array(z.object({ path, dependents: z.number().int().nonnegative() }))
        .max(100),
      cycles: z.array(z.array(path).min(1).max(500)).max(1_000),
      unusedFiles: z.array(path).max(MANY),
      unusedExports: z.array(z.object({ path, name: z.string().max(200) })).max(MANY),
      unguardedRoutes: z.array(z.string().max(1100)).max(MANY),
    }),
  });
}

export type GraphDocument = z.infer<typeof GraphContract.document>;
export type GraphFile = z.infer<typeof GraphContract.file>;
export type GraphEdge = z.infer<typeof GraphContract.edge>;
export type GraphRoute = z.infer<typeof GraphContract.route>;
export type GraphCall = z.infer<typeof GraphContract.call>;
export type GraphLanguage = (typeof GRAPH_LANGUAGES)[number];
export type GraphFramework = (typeof GRAPH_FRAMEWORKS)[number];
export type FileRole = (typeof FILE_ROLES)[number];
export type EdgeKind = (typeof EDGE_KINDS)[number];
export type HttpMethod = (typeof HTTP_METHODS)[number];
