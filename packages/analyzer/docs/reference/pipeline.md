---
title: Pipeline
description: Walk, parse, resolve, classify, route, match, insight — each stage, what it decides, and how the coverage figure is counted.
---

# Pipeline

For each repository:

1. **Layout.** `RepositoryLayoutReader` reads how the repository is split into packages:
   - npm and yarn `workspaces`, and `pnpm-workspace.yaml`;
   - composer's PSR-4 map and its `path` repositories.

   Each file belongs to the deepest package that holds it. A plugin applies to a file when that
   package, or the repository root, depends on the plugin's framework.
2. **Walk.** `FileWalker` collects TypeScript, JavaScript and PHP files. It skips:
   - `.d.ts` files, minified bundles, and anything over 1 MB;
   - `DEFAULT_IGNORE` plus the project's ignores;
   - the root `.gitignore` (negations are not supported).
3. **Parse.**
   - TypeScript and JavaScript go through `ts.createSourceFile`. That yields imports with the
     names they take (`default`, a named import, or `*` for a namespace, a side effect or a
     re-export of everything), `require` and `import()` with a literal, and exports.
   - PHP goes through tree-sitter. That yields `use` clauses, `require` and `include`, declared
     classes, and the class names used without a `use` (`extends Base` in the same namespace).
4. **Resolve.**
   - Relative imports are probed directly.
   - Workspace packages map to their **source**: a `dist/` entry is tried as `src/`. A runner's
     checkout has no `node_modules`, so this is the only way across packages.
   - Everything else goes to `ts.resolveModuleName` with the nearest `tsconfig.json`, or with the
     project's `settings.tsconfigPath`.
   - PHP class names go through PSR-4.
5. **Classify.** The first plugin with an opinion decides. Otherwise `RoleClassifier`'s path
   rules apply, and `source` is the fallback.
6. **Routes and injections** come from the plugins. Then each plugin's global pass runs: Nest's
   global prefix and `forRoutes` middleware, and the Next.js middleware matcher.
7. **Ground truth.** An `openapi.json` or `openapi.yaml` (or `swagger.*`) in the repository adds
   routes, and replaces the static route with the same method and path. With `artisan: true`,
   `php artisan route:list --json` replaces every statically read Laravel route.

Then, across every repository:
- **calls** are matched to routes;
- **`api` edges** are drawn from the calling file to the handler's file;
- **insights** are computed with `GraphIndex`.

## Coverage

`coverage.total` counts every import that **looks internal**:
- relative;
- matching a `tsconfig` `paths` alias, or a conventional one (`@/`, `~/`, `#`);
- a workspace package;
- a PHP class under a mapped PSR-4 prefix.

`coverage.resolved` counts the ones that found a file. Package imports are counted in neither.
Neither is a PHP implicit reference, because nobody wrote it as an import.

The explorer's banner is these two numbers.

## Matching calls to routes

`CallExtractor` finds these calls:
- `fetch`, `$fetch`, `ofetch`, `ky` and `axios` called directly;
- `.get`, `.post` and the other verbs on a client created in the same file with
  `axios.create` or `ky.create`. That client's literal `baseURL` is prefixed;
- `.get`, `.post` and the other verbs on a receiver conventionally named for one (`api`, `http`,
  `client`).

URLs are normalised in three ways:
- template placeholders and concatenated variables become `:param`;
- the origin and the query are dropped;
- a leading variable is dropped as a base URL.

`RouteMatcher` compares segment by segment. A parameter on either side matches any segment, but
**at least one literal segment must agree**, so `/health` never matches `/users/:id`. The most
literal match wins.

**A match is `certain` only when** the URL was a plain literal, no base was dropped, and the
whole path matched rather than a suffix of it.

## Insights

| Insight | How |
|---|---|
| Most depended-on | The top ten by distinct importers, over `import` edges |
| Cycles | `GraphIndex.cycles()` over `import` edges |
| Unused files | Not reachable from any entry point over every edge kind. Entry points come from the plugins (pages, routes, `main.ts` with `NestFactory`, Laravel's `routes/` and providers), from `package.json` (`main`, `bin`, `exports`), and from test, config and migration files. **Only judged in packages with at least one known entry**, so a library with no `main` is not reported as entirely unused |
| Unused exports | Exports no edge imports by name, in files that are not entries |
| Unguarded routes | Routes with no guard, apart from `OPTIONS` and `HEAD` |
