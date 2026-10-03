import {
  GRAPH_VERSION,
  type GraphCall,
  type GraphDocument,
  type GraphEdge,
  type GraphFile,
  type GraphFramework,
  type GraphLanguage,
  type GraphRoute,
  type HttpMethod,
  readFile,
} from "../import.js";
import { InsightBuilder } from "../insight/index.js";
import { PhpParser, TypescriptParser } from "../language/index.js";
import { CallExtractor, RouteMatcher } from "../match/index.js";
import type { ParsedFile } from "../model/index.js";
import { RouteSource, type SourcedRoute } from "../openapi/index.js";
import {
  type FrameworkPlugin,
  LaravelPlugin,
  NestjsPlugin,
  NextjsPlugin,
  type PluginContext,
  TanstackStartPlugin,
} from "../plugin/index.js";
import { PhpResolver, SourceProbe, TypescriptResolver } from "../resolve/index.js";
import { RoleClassifier } from "../role/index.js";
import { FileWalker } from "../walk/index.js";
import { type RepositoryLayout, RepositoryLayoutReader } from "../workspace/index.js";

export interface AnalyzedRepository {
  // As it appears in the document, `owner/name` for a GitHub repository.
  readonly name: string;
  readonly root: string;
  readonly commit?: string | null;
  readonly branch?: string | null;
}

export interface AnalyzeOptions {
  readonly repositories: readonly AnalyzedRepository[];
  // Added to the defaults, `.gitignore`-shaped.
  readonly ignore?: readonly string[];
  // A project's `settings.tsconfigPath`: one tsconfig for every file instead of the nearest.
  readonly tsconfigPath?: string | null;
  // Run `php artisan route:list --json` for Laravel routes. Needs PHP and installed vendors.
  readonly artisan?: boolean;
  // `tree-sitter-php.wasm`, for a bundled host that ships it beside itself.
  readonly phpGrammar?: string;
  readonly version?: string;
  readonly now?: () => Date;
}

interface MutableRoute {
  method: HttpMethod;
  path: string;
  local: string;
  line: number;
  guards: string[];
  framework: GraphFramework;
  source: GraphRoute["source"];
}

export const DEFAULT_IGNORE: readonly string[] = Object.freeze([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".output",
  "vendor",
  "coverage",
  ".turbo",
  ".nuxt",
  ".svelte-kit",
  "storage",
  "bootstrap/cache",
]);

const PLUGINS: readonly FrameworkPlugin[] = [
  new NestjsPlugin(),
  new NextjsPlugin(),
  new TanstackStartPlugin(),
  new LaravelPlugin(),
];

// Reads one or more repositories and produces the `GraphDocument` a scan uploads. Source is
// read here and nowhere else; what leaves is paths, names, lines and counts.
export class Analyzer {
  private constructor() {}

  public static async run(options: AnalyzeOptions): Promise<GraphDocument> {
    const started = performance.now();
    const multi = options.repositories.length > 1;
    const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];
    const files: GraphFile[] = [];
    const edges = new Map<string, GraphEdge>();
    const unresolved: GraphDocument["unresolved"] = [];
    const coverage = { resolved: 0, total: 0 };
    const routes: (MutableRoute & { repository: string; prefix?: string })[] = [];
    const frameworks = new Map<string, { id: GraphFramework; repository: string }>();
    const entries = new Set<string>();
    const judged = new Set<string>();
    const parsedAll: { repository: string; prefix: string; file: ParsedFile }[] = [];

    for (const repository of options.repositories) {
      const prefix = multi ? `${repository.name.split("/").pop() ?? repository.name}/` : "";
      const layout = await RepositoryLayoutReader.read(repository.root);
      const walked = await FileWalker.walk(repository.root, ignore);
      if (walked.some((file) => file.local.endsWith(".php")))
        await PhpParser.init(options.phpGrammar);
      const locals = new Set(walked.map((file) => file.local));

      const parsed = new Map<string, ParsedFile>();
      for (const walkedFile of walked) {
        const text = await readFile(walkedFile.absolute, "utf8");
        parsed.set(
          walkedFile.local,
          Analyzer.parse(repository.name, prefix, walkedFile, text, layout),
        );
      }

      const tsResolver = new TypescriptResolver(
        repository.root,
        locals,
        layout.packages,
        options.tsconfigPath ?? null,
      );
      const phpResolver = new PhpResolver(locals, layout.composers);
      const resolve = (file: ParsedFile, specifier: string) =>
        file.language === "php"
          ? phpResolver.resolve(file.local, specifier)
          : tsResolver.resolve(file.local, specifier);
      const context: PluginContext = {
        files: parsed,
        resolve: (file, specifier) => {
          const result = resolve(file, specifier);
          return result.kind === "file" ? result.local : null;
        },
      };

      const active = (file: ParsedFile) => Analyzer.pluginsFor(file, layout);
      const repositoryRoutes = new Map<
        FrameworkPlugin,
        (MutableRoute & { repository: string })[]
      >();
      const packageHasEntry = new Set<string>();

      for (const file of parsed.values()) {
        const plugins = active(file);
        for (const plugin of plugins)
          frameworks.set(`${plugin.id}:${repository.name}`, {
            id: plugin.id,
            repository: repository.name,
          });
        file.role =
          plugins.map((plugin) => plugin.classify?.(file) ?? null).find((role) => role !== null) ??
          RoleClassifier.classify(file.local);
        if (
          plugins.some((plugin) => plugin.isEntry?.(file)) ||
          ["test", "config", "migration"].includes(file.role)
        ) {
          entries.add(file.path);
          packageHasEntry.add(file.packageDir);
        }

        for (const ref of file.imports) {
          const result = resolve(file, ref.specifier);
          if (result.kind === "external") continue;
          if (!ref.implicit) {
            coverage.total += 1;
            if (result.kind !== "unresolved") coverage.resolved += 1;
          }
          if (result.kind === "unresolved" && !ref.implicit)
            unresolved.push({ from: file.path, specifier: ref.specifier.slice(0, 1024) });
          if (result.kind === "file" && result.local !== file.local) {
            Analyzer.addEdge(edges, {
              from: file.path,
              to: prefix + result.local,
              kind: "import",
              certain: result.certain,
              names: [...ref.names],
            });
          }
        }
        for (const plugin of plugins) {
          for (const inject of plugin.injects?.(file, context) ?? []) {
            Analyzer.addEdge(edges, {
              from: file.path,
              to: prefix + inject.to,
              kind: "inject",
              certain: true,
            });
          }
          for (const route of plugin.routes?.(file, context) ?? []) {
            const list = repositoryRoutes.get(plugin) ?? [];
            list.push({
              repository: repository.name,
              method: route.method,
              path: route.path,
              local: route.handler?.local ?? file.local,
              line: route.handler?.line ?? route.line,
              guards: [...route.guards],
              framework: plugin.id,
              source: "static",
            });
            repositoryRoutes.set(plugin, list);
          }
        }
        if (file.language !== "php" && Analyzer.dependsOn(file, layout, "react")) {
          frameworks.set(`react:${repository.name}`, { id: "react", repository: repository.name });
        }
      }

      // Package entry points from `package.json`, mapped to the source files they name.
      const probe = new SourceProbe(locals);
      for (const info of layout.packages) {
        for (const entry of info.entries) {
          const found = probe.find(
            entry.replace(/\/(dist|build|lib|out)\//, "/src/").replace(/\.d\.[cm]?ts$/, ""),
          );
          if (found) {
            entries.add(prefix + found);
            packageHasEntry.add(info.dir);
          }
        }
      }
      for (const file of parsed.values())
        if (packageHasEntry.has(file.packageDir)) judged.add(file.path);

      for (const [plugin, list] of repositoryRoutes) {
        plugin.guard?.(
          list,
          [...parsed.values()].filter((file) => active(file).includes(plugin)),
        );
        routes.push(...list);
      }

      const backend = [...repositoryRoutes.keys()][0]?.id ?? "other";
      const openapi = await RouteSource.openapi(repository.root, ignore);
      Analyzer.merge(routes, openapi, repository.name, backend, "openapi", context, parsed);
      if (
        options.artisan &&
        layout.composers.some((composer) => composer.require.has("laravel/framework"))
      ) {
        const artisan = await RouteSource.artisan(repository.root).catch(() => null);
        if (artisan) {
          for (let index = routes.length - 1; index >= 0; index -= 1) {
            const route = routes[index];
            if (route?.repository === repository.name && route.framework === "laravel")
              routes.splice(index, 1);
          }
          Analyzer.merge(routes, artisan, repository.name, "laravel", "artisan", context, parsed);
        }
      }

      for (const file of parsed.values()) {
        files.push({
          path: file.path,
          repository: repository.name,
          language: file.language,
          role: file.role,
          loc: file.loc,
          exports: [...file.exports].slice(0, 2_000),
        });
        parsedAll.push({ repository: repository.name, prefix, file });
      }
      // Locals are repository-relative until here; the document's paths carry the prefix.
      for (const route of routes) {
        if (route.repository !== repository.name || route.prefix !== undefined) continue;
        route.prefix = prefix;
        route.local = prefix + route.local;
      }
    }

    // One id per route; the first declaration of a duplicate wins.
    const graphRoutes: GraphRoute[] = [];
    const seen = new Set<string>();
    for (const route of routes) {
      const id = `${route.method} ${route.path}`;
      if (seen.has(id)) continue;
      seen.add(id);
      graphRoutes.push({
        id,
        method: route.method,
        path: route.path,
        file: route.local,
        line: route.line,
        framework: route.framework,
        guards: route.guards.slice(0, 50),
        source: route.source,
      });
    }

    const matcher = new RouteMatcher(graphRoutes);
    const calls: GraphCall[] = [];
    const byId = new Map(graphRoutes.map((route) => [route.id, route]));
    for (const { file } of parsedAll) {
      for (const call of CallExtractor.extract(file)) {
        const matched = matcher.match(call);
        calls.push({
          file: file.path,
          line: call.line,
          method: call.method,
          url: call.url,
          route: matched?.route.id ?? null,
          certain: matched?.certain ?? false,
        });
        const target = matched ? byId.get(matched.route.id)?.file : undefined;
        if (target && target !== file.path)
          Analyzer.addEdge(edges, {
            from: file.path,
            to: target,
            kind: "api",
            certain: matched?.certain ?? false,
          });
      }
    }

    const edgeList = [...edges.values()];
    const languages = new Map<GraphLanguage, number>();
    for (const file of files) languages.set(file.language, (languages.get(file.language) ?? 0) + 1);

    return {
      version: GRAPH_VERSION,
      meta: {
        analyzer: options.version ?? "0.1.0",
        generatedAt: (options.now?.() ?? new Date()).toISOString(),
        repositories: options.repositories.map((repository) => ({
          name: repository.name,
          commit: repository.commit ?? null,
          branch: repository.branch ?? null,
        })),
        timings: { totalMs: Math.round(performance.now() - started) },
      },
      languages: [...languages].map(([id, count]) => ({ id, files: count })),
      frameworks: [...frameworks.values()],
      files,
      edges: edgeList,
      unresolved,
      coverage,
      routes: graphRoutes,
      calls,
      insights: InsightBuilder.build(files, edgeList, graphRoutes, entries, judged),
    };
  }

  private static parse(
    repository: string,
    prefix: string,
    walked: { local: string; absolute: string },
    text: string,
    layout: RepositoryLayout,
  ): ParsedFile {
    const php = walked.local.endsWith(".php");
    const language: GraphLanguage = php
      ? "php"
      : /\.[cm]?tsx?$/.test(walked.local)
        ? "typescript"
        : "javascript";
    const owner = php
      ? RepositoryLayoutReader.owner(layout.composers, walked.local)
      : RepositoryLayoutReader.owner(layout.packages, walked.local);
    const base = {
      path: prefix + walked.local,
      local: walked.local,
      absolute: walked.absolute,
      repository,
      packageDir: owner?.dir ?? "",
      language,
      text,
      loc: text === "" ? 0 : text.split("\n").length,
      role: "source" as const,
    };
    if (php) {
      const parsed = PhpParser.parse(text);
      return {
        ...base,
        imports: parsed.imports,
        exports: parsed.exports,
        php: {
          tree: parsed.tree,
          root: parsed.root,
          namespace: parsed.namespace,
          uses: parsed.uses,
        },
      };
    }
    const parsed = TypescriptParser.parse(walked.local, text);
    return { ...base, imports: parsed.imports, exports: parsed.exports, typescript: parsed.ast };
  }

  private static dependsOn(file: ParsedFile, layout: RepositoryLayout, name: string): boolean {
    const owner = RepositoryLayoutReader.owner(layout.packages, file.local);
    return (
      owner?.dependencies.has(name) === true ||
      layout.packages.some((each) => each.dir === "" && each.dependencies.has(name))
    );
  }

  // A plugin applies to a file whose own package, or the repository root, depends on it.
  private static pluginsFor(file: ParsedFile, layout: RepositoryLayout): FrameworkPlugin[] {
    if (file.language === "php") {
      const composer = RepositoryLayoutReader.owner(layout.composers, file.local);
      const root = layout.composers.find((each) => each.dir === "");
      return PLUGINS.filter((plugin) =>
        plugin.composer?.some((name) => composer?.require.has(name) || root?.require.has(name)),
      );
    }
    const owner = RepositoryLayoutReader.owner(layout.packages, file.local);
    const root = layout.packages.find((each) => each.dir === "");
    return PLUGINS.filter((plugin) =>
      plugin.npm?.some((name) => owner?.dependencies.has(name) || root?.dependencies.has(name)),
    );
  }

  // Ground truth beats reading: a sourced route replaces a static one with the same method
  // and path, keeping the static one's file, line and guards when it had them.
  private static merge(
    routes: (MutableRoute & { repository: string })[],
    sourced: readonly SourcedRoute[],
    repository: string,
    framework: GraphFramework,
    source: GraphRoute["source"],
    context: PluginContext,
    parsed: ReadonlyMap<string, ParsedFile>,
  ): void {
    for (const route of sourced) {
      const existing = routes.find(
        (each) =>
          each.repository === repository &&
          each.method === route.method &&
          each.path === route.path,
      );
      let local = route.local;
      let line = route.line;
      if (route.action) {
        const from = [...parsed.values()].find((file) => file.language === "php");
        const target = from ? context.resolve(from, route.action.className) : null;
        if (target) {
          local = target;
          line = 1;
        }
      }
      if (existing) {
        existing.source = source;
        if (existing.guards.length === 0) existing.guards.push(...route.guards);
        continue;
      }
      routes.push({
        repository,
        method: route.method,
        path: route.path,
        local,
        line,
        guards: [...route.guards],
        framework,
        source,
      });
    }
  }

  // One edge per pair and kind; a second import of the same file adds its names.
  private static addEdge(edges: Map<string, GraphEdge>, edge: GraphEdge): void {
    const key = `${edge.kind}\u0000${edge.from}\u0000${edge.to}`;
    const held = edges.get(key);
    if (!held) {
      edges.set(key, edge);
      return;
    }
    const names = [...new Set([...(held.names ?? []), ...(edge.names ?? [])])].slice(0, 500);
    edges.set(key, {
      ...held,
      certain: held.certain || edge.certain,
      ...(names.length > 0 ? { names } : {}),
    });
  }
}
