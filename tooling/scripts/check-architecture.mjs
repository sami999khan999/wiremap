// The rules types cannot express, checked as text.
//
// Every assertion here is deliberately a grep rather than a lint rule: it is
// independent of ESLint config, cannot be silenced by an inline comment, and keeps
// working if someone reorganises the lint setup. See docs/setup/26.
//
// Run: pnpm check:architecture

// @ts-check

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  closingBracket,
  columnsOf,
  foreignKeysOf,
  indexesOf,
  lineOf,
  outsideFences,
  specifiers,
  topLevelAwait,
  withoutComments,
} from "./source-text.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// `.claude` holds agent scratch space — skills, and at one point a full worktree checkout,
// which every grep here would have counted twice. Excluded by construction, not by luck.
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".output",
  ".git",
  ".claude",
  "migrations",
  "src-tauri",
]);

const results = [];

// ── helpers ──────────────────────────────────────────────────────────────────

function walk(dir, extensions) {
  if (!existsSync(dir)) return [];
  const out = [];

  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }

  return out;
}

function packageDirs() {
  const base = join(ROOT, "packages");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((name) => join(base, name))
    .filter((dir) => existsSync(join(dir, "package.json")));
}

// Everything first-party. An assertion about how source is written has no reason to
// stop at `packages/` — an app is source someone reads too.
function sourceDirs() {
  const out = [...packageDirs()];
  const apps = join(ROOT, "apps");

  if (existsSync(apps)) {
    for (const name of readdirSync(apps)) {
      const dir = join(apps, name);
      if (existsSync(join(dir, "package.json"))) out.push(dir);
    }
  }

  return out;
}

// A generated file is not written by anyone, and `route-tree.gen.ts` asks in its own
// header to be excluded from every checker pointed at it.
function sourceFiles(dir) {
  return [
    ...walk(join(dir, "src"), [".ts", ".tsx"]),
    ...walk(join(dir, "tests"), [".ts", ".tsx"]),
  ].filter((file) => !/\.gen\.tsx?$/.test(file));
}

function rel(file) {
  return relative(ROOT, file).replaceAll("\\", "/");
}

// The most recently modified file among `files`, as epoch milliseconds. 0 for none, so a
// caller comparing two of these treats "nothing there" as "older than anything".
function newestMtime(files) {
  return files.reduce((newest, file) => Math.max(newest, statSync(file).mtimeMs), 0);
}

// Every `pgTable(...)` in the drizzle schema, split at the columns object so that a
// column declaration and an index declaration are never matched by the same regex.
function pgTableBlocks() {
  const dir = join(ROOT, "packages/infrastructure/src");
  if (!existsSync(dir)) return null;

  const files = walk(dir, [".ts"]).filter((file) => file.endsWith(".schema.ts"));
  if (files.length === 0) return null;

  const blocks = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(/\bpgTable\(\s*["'`]([^"'`]+)["'`]\s*,/g)) {
      const open = source.indexOf("(", match.index);
      const call = source.slice(open, closingBracket(source, open) + 1);
      const brace = call.indexOf("{");
      const braceEnd = closingBracket(call, brace);

      blocks.push({
        file,
        table: match[1] ?? "",
        columns: call.slice(brace, braceEnd + 1),
        extras: call.slice(braceEnd + 1),
      });
    }
  }

  return blocks;
}

function assert(name, run) {
  const failures = [];
  const skipped = run(failures);
  results.push({ name, failures, skipped });
}

// ── 1 — `application` imports no framework ───────────────────────────────────

const FRAMEWORKS = [
  "@orpc/",
  "@tanstack/",
  "@nestjs/",
  "drizzle-orm",
  "ioredis",
  "bullmq",
  "@aws-sdk/",
  "better-auth",
  "pg",
  "express",
  "fastify",
  "hono",
];

assert("`application` imports no framework", (failures) => {
  for (const file of walk(join(ROOT, "packages/application/src"), [".ts", ".tsx"])) {
    const source = readFileSync(file, "utf8");

    for (const specifier of specifiers(source)) {
      const banned = FRAMEWORKS.find((b) => specifier === b || specifier.startsWith(b));
      if (banned) {
        failures.push(`${rel(file)}:${lineOf(source, specifier)} imports ${specifier}`);
      }
    }
  }
});

// ── 2 — `application` does not log ───────────────────────────────────────────

assert("`application` does not log", (failures) => {
  for (const file of walk(join(ROOT, "packages/application/src"), [".ts", ".tsx"])) {
    const source = readFileSync(file, "utf8");

    if (specifiers(source).includes("@loadbearing/observability")) {
      failures.push(`${rel(file)} imports @loadbearing/observability — the domain does not log`);
    }
  }
});

// ── 3 — only `env.ts` reads `process.env` ────────────────────────────────────

// Must stay in step with Biome's `noProcessEnv` overrides in
// tooling/biome-config/src/base.json. A path exempted in one and not the other is either
// a gate that passes while the rule is broken, or a build that fails for no reason.
// Kept byte-for-byte in step with the `noProcessEnv` override in
// tooling/biome-config/src/base.json. Doc 26 assertion 3 calls drift between the two
// out by name: a gate that passes while the rule is broken, or a build that fails for
// no reason. Change one, change the other.
const ENV_EXEMPT = [
  /^apps\/[^/]+\/src\/env\.ts$/,
  // A repo, package or app root config — never one inside `src/`. The bare
  // `*.config.*` glob exempted `composition/src/container/container.config.ts` and
  // `auth/src/factory/auth.config.ts`, which are runtime code with a role suffix.
  /^[^/]+\.config\.(ts|mts|js|mjs)$/,
  /^(packages|apps)\/[^/]+\/[^/]+\.config\.(ts|mts|js|mjs)$/,
  // Every runnable script sits above `src/`, so a folder barrel can be imported without
  // executing one — see packages/infrastructure/seed.ts for the failure that moved them.
  /^packages\/auth\/tables\.ts$/,
  // Each suite's own `env.ts`: the one file in it that reads the environment, so the
  // harness dials the ports `.env` names rather than a literal that silently drifts.
  /^packages\/(composition|infrastructure)\/tests\/support\/(config|database)\.ts$/,
  // The web smoke's `globalSetup`: it spawns the built server, so it composes that
  // child's whole environment out of the one it was given.
  /^apps\/web\/tests\/smoke\/support\/server\.ts$/,
  // The production entry that forks the web workers: it sizes the pool before any app
  // code, and so before `env.ts`, has run.
  /^apps\/web\/cluster\.mjs$/,
  /^packages\/infrastructure\/(ai-reindex|doc-bench|migrate|partitions|platform-grant|queue-replay|seed|shard-env|smoke)\.ts$/,
];

assert("only `env.ts` reads `process.env`", (failures) => {
  const roots = [join(ROOT, "packages"), join(ROOT, "apps")];

  for (const root of roots) {
    // Every extension Biome lints and the exemption list names — walking only
    // `.ts` would leave `*.config.mjs` unchecked here but still checked by Biome.
    for (const file of walk(root, [".ts", ".tsx", ".mts", ".js", ".mjs"])) {
      const path = rel(file);
      if (ENV_EXEMPT.some((pattern) => pattern.test(path))) continue;

      // Comments stripped first: a line explaining that `process.env` is banned here is
      // not a read of it, and this assertion used to fail on its own documentation.
      const source = withoutComments(readFileSync(file, "utf8"));
      if (/\bprocess\s*\.\s*env\b/.test(source)) {
        failures.push(`${path}:${lineOf(source, "process.env")} reads process.env`);
      }
    }
  }
});

// ── 4 — every `@orpc/*` entry is on one version line ─────────────────────────

assert("every `@orpc/*` entry is on one version line", (failures) => {
  const catalog = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const seen = new Map();

  for (const line of catalog.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*"?(@orpc\/[a-z-]+)"?:\s*(\S+)/.exec(line);
    if (match) seen.set(match[1], match[2]);
  }

  const ranges = new Set(seen.values());
  if (seen.size === 0) failures.push("no @orpc/* entries found in pnpm-workspace.yaml");

  if (ranges.size > 1) {
    const detail = [...seen].map(([name, range]) => `${name}@${range}`).join(", ");
    failures.push(`${ranges.size} version lines across ${seen.size} packages — ${detail}`);
  }
});

// ── 5 — no block comments in src/ or tests/ ──────────────────────────────────
//
// docs/opinions/comments.md. A block comment always begins its own line once Biome
// has formatted the file, so anchoring to the line start cannot mistake a glob
// like "**/dist/**" inside a string for a comment.

assert("comments are `//`, never a block", (failures) => {
  for (const dir of sourceDirs()) {
    for (const file of sourceFiles(dir)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const trimmed = line.trimStart();
          // `{/*` is the JSX form and reads as an exemption if it is not named.
          if (trimmed.startsWith("/*") || trimmed.startsWith("{/*")) {
            failures.push(`${rel(file)}:${index + 1} block comment — use //`);
          }
        });
    }
  }
});

// ── 6 — no top-level await in a package barrel ───────────────────────────────
//
// A CJS consumer — the default NestJS and Express scaffold — reaches an ESM
// package through `require(esm)`, which is unflagged on Node 22.12+ but refuses
// any module graph containing a top-level await.

assert("no top-level await in a built barrel", (failures) => {
  let checked = 0;

  for (const dir of packageDirs()) {
    const bundle = join(dir, "dist/index.js");
    if (!existsSync(bundle)) continue;
    checked += 1;

    const line = topLevelAwait(readFileSync(bundle, "utf8"));
    if (line) {
      failures.push(`${rel(bundle)}:${line} top-level await breaks require() from CJS`);
    }
  }

  if (checked === 0) return "no dist/ found — run `pnpm build:packages` first";
  return null;
});

// ── 7 — `"use client"` only where it belongs ─────────────────────────────────
//
// docs/setup/06. Marking an isomorphic package client-only is the failure mode:
// it breaks SSR of translated copy and authorization inside a Server Component.

const CLIENT_PACKAGES = new Set(["ui", "query", "feature"]);

assert('`"use client"` only in ui, query, feature', (failures) => {
  // `sourceDirs()`, not `packageDirs()`: the rule is repo-wide, and an `apps/*` tree was
  // exempt by accident — a boundary there is the one that reaches a route component.
  for (const dir of sourceDirs()) {
    const name = dir.split(/[\\/]/).pop() ?? "";
    if (CLIENT_PACKAGES.has(name)) continue;

    for (const file of walk(join(dir, "src"), [".ts", ".tsx"])) {
      const source = readFileSync(file, "utf8");
      if (/^\s*["']use client["']/m.test(source)) {
        failures.push(`${rel(file)} is isomorphic and must not declare a client boundary`);
      }
    }
  }
});

// ── 8 — no server code in the client bundle ──────────────────────────────────

const SERVER_FINGERPRINTS = ["drizzle-orm", "pg-pool", "@aws-sdk/client-s3", "ioredis", "bullmq"];
// One per key group in the `email` namespace, which `SERVER_CATALOG` alone can reach.
// Enumerated rather than the bare prefix `"email."`, which is a common enough substring
// in minified output to make this assertion fail on something unrelated.
const EMAIL_FINGERPRINTS = [
  "email.digest.",
  "email.verify.",
  "email.reset.",
  "email.change.",
  "email.otp.",
  // Was missing: the invitation copy could have reached a bundle and this would not have
  // noticed. `email.notification.` is Phase 3's and is listed before its copy exists.
  "email.invitation.",
  "email.notification.",
];

// Field names from the `env.ts` schemas, which no adapter drags in on its own — they
// arrive only when a route file or `router.tsx` imports `Env` for one accessor. That
// happened, and the grep above did not see it: `Env` imports no server *package*, so the
// bundle carried the whole server configuration surface and a `Schema.parse({})` that
// threw before the first render. These names are the fingerprint of the file itself.
const ENV_FINGERPRINTS = [
  "REDIS_QUEUE_URL",
  "S3_FORCE_PATH_STYLE",
  "AUTH_COOKIE_CACHE_MAX_AGE_SECONDS",
  // The OAuth client secret. It reaches `Env` and nothing else, and the sign-in page
  // deliberately learns whether Google is configured from the session snapshot rather
  // than from this schema — so its name in the bundle means that boundary was crossed.
  "GOOGLE_CLIENT_SECRET",
  "AUTH_ENROLMENT_MODE",
  // Server-only for a reason that is not obvious: the cap is enforced in the subscriber
  // adapter, so a client that knew it would only be able to work around it.
  "REALTIME_MAX_STREAMS_PER_USER",
];
const ENTRY_FINGERPRINTS = ["সংরক্ষণ"];

const CLIENT_OUTPUTS = [
  "apps/web/.output/public/_build/assets",
  "apps/web/dist/client/assets",
  "apps/web/.output/public/assets",
];

assert("no server code in the client bundle", (failures) => {
  const dir = CLIENT_OUTPUTS.map((c) => join(ROOT, c)).find((c) => existsSync(c));
  if (!dir) return "apps/web has no client build — run `pnpm --filter @loadbearing/web build`";

  const assets = walk(dir, [".js", ".mjs", ".css"]);

  // A grep over an empty folder passes silently and gives false confidence forever.
  if (assets.length === 0) {
    failures.push(`${rel(dir)} contains no assets — the output path moved, fix this script`);
    return null;
  }

  // The whole assertion is a grep over an artefact, so it is only worth as much as the
  // artefact is current. A green run against a bundle built before the edit under review
  // is how the client boundary was last reported clean while it was not.
  const sources = walk(join(ROOT, "apps/web/src"), [".ts", ".tsx", ".css"]);
  if (newestMtime(sources) > newestMtime(assets)) {
    failures.push(
      "apps/web/.output is older than apps/web/src — rebuild before trusting this assertion",
    );
    return null;
  }

  for (const file of assets) {
    const source = readFileSync(file, "utf8");

    for (const print of [...SERVER_FINGERPRINTS, ...EMAIL_FINGERPRINTS, ...ENV_FINGERPRINTS]) {
      if (source.includes(print)) failures.push(`${rel(file)} contains "${print}"`);
    }
  }

  // A locale string in a lazily-loaded chunk is the split working as designed. It
  // is only a failure in the entry chunk, which is what "not a static import" means.
  const entry = assets.find((f) => /(^|[\\/])(index|entry|main)[.-][^\\/]*\.js$/.test(f));
  if (!entry) {
    failures.push("could not identify an entry chunk — fix this script rather than skipping");
    return null;
  }

  const entrySource = readFileSync(entry, "utf8");
  for (const print of ENTRY_FINGERPRINTS) {
    if (entrySource.includes(print)) {
      failures.push(`${rel(entry)} statically includes a non-English locale ("${print}")`);
    }
  }

  return null;
});

// ── 9 — every domain table declares organization_id ──────────────────────────
//
// The tenant column is the sharding key and the boundary every repository query
// narrows by. Drizzle tables are data, so no type can express this. See
// docs/opinions/data-and-scale.md.

// The tenant column, in one place: a fork sharding by another edits this and §17
// follows. Asserted equal to `TenantKey` on the allowlist below.
const TENANT_COLUMN = "organization_id";

// **Derived, not listed.** A table is tenant-exempt exactly when `TablePlacement`
// calls it catalog — so it cannot be catalog in one file and exempt in another, which
// is the drift a second hand-written list guarantees.
const catalogTables = () => {
  const file = join(ROOT, "packages/application/src/primitive/shard.ts");
  if (!existsSync(file)) return null;

  const source = readFileSync(file, "utf8");
  const block = source.slice(source.indexOf("const CATALOG = Object.freeze(["));
  const names = [...block.slice(0, block.indexOf("]")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  return names.length > 0 ? new Set(names) : null;
};

// The one name that is nobody's table: drizzle writes it and no schema file declares it.
const TENANT_EXEMPT_EXTRA = new Set(["__drizzle_migrations"]);

assert("every domain table declares `organization_id`", (failures) => {
  const catalog = catalogTables();
  if (!catalog) return "packages/application has no shard.ts yet";

  const dir = join(ROOT, "packages/infrastructure/src");
  if (!existsSync(dir)) return "packages/infrastructure has no src/ yet";

  const blocks = pgTableBlocks();
  if (!blocks) return "no *.schema.ts files yet";

  for (const block of blocks) {
    if (catalog.has(block.table) || TENANT_EXEMPT_EXTRA.has(block.table)) continue;

    // The same bracket-matched parse §17 and §18 use, and the same whole-name test: the
    // regex this replaced anchored on `\n});` at column 0, so a table Biome wrapped
    // differently was skipped silently, and a substring match would count
    // `last_active_organization_id` as a tenant column.
    if (columnsOf(block).some((column) => column.column === TENANT_COLUMN)) continue;

    failures.push(`${rel(block.file)}: table "${block.table}" has no ${TENANT_COLUMN}`);
  }

  return null;
});

// ── 10 — the audit port is ActivityLogger, never AuditTrail ──────────────────
//
// The name drifted once already: the observability docs said AuditTrail while
// eleven other files said ActivityLogger. Two names for the audit port reads as
// two things, which is the exact confusion the audit/diagnostic split prevents.

// The two pages that state the ban, and therefore have to spell the banned name. Anywhere
// else it is the drift this assertion exists to catch.
const AUDIT_NAME_EXEMPT = new Set(["docs/setup/26-hygiene-and-ci.md", "docs/opinions/index.md"]);

assert("the audit port is `ActivityLogger`, never `AuditTrail`", (failures) => {
  // `docs/` included: the drift this was written for lived in the observability prose, and
  // walking only the packages meant the assertion could not see the thing it was about.
  for (const base of ["packages", "apps", "docs"]) {
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;

    for (const file of walk(dir, [".ts", ".tsx", ".md"])) {
      if (AUDIT_NAME_EXEMPT.has(rel(file))) continue;

      const source = readFileSync(file, "utf8");
      if (source.includes("AuditTrail")) {
        failures.push(`${rel(file)}:${lineOf(source, "AuditTrail")} names AuditTrail`);
      }
    }
  }

  return null;
});

// ── 11 — the schema barrel names every *.schema.ts ───────────────────────
//
// An empty or incomplete barrel passes typecheck, lint, build, and every test:
// `import * as schema` from an empty module is legal and yields `{}`. The only tool
// that notices is drizzle-kit, and it notices by generating DROP TABLE for every
// table it can no longer see. That happened once. This is the guard.

assert("the schema barrel names every `*.schema.ts`", (failures) => {
  const dir = join(ROOT, "packages/infrastructure/src/pg/schema");
  if (!existsSync(dir)) return "packages/infrastructure has no schema/ yet";

  const barrel = join(dir, "index.ts");
  if (!existsSync(barrel)) {
    failures.push("packages/infrastructure/src/pg/schema/index.ts is missing");
    return null;
  }

  const source = readFileSync(barrel, "utf8");
  const files = walk(dir, [".ts"]).filter((file) => file.endsWith(".schema.ts"));

  if (files.length === 0) {
    failures.push("packages/infrastructure/src/pg/schema holds no *.schema.ts files");
    return null;
  }

  for (const file of files) {
    const specifier = `./${basename(file, ".ts")}.js`;
    if (!source.includes(specifier)) {
      failures.push(`${rel(barrel)} does not re-export ${specifier}`);
    }
  }

  return null;
});

// ── 12 — the rule files route to every opinions page ────────────────────────
//
// docs/ai/rules/*.md is a digest of docs/opinions/, and a digest is a second copy of
// every rule it states. The failure is not that it is wrong on the day it is written —
// it is that a tenth opinions page lands months later, no rule file mentions it, and
// every agent works from a rulebook missing a chapter while nothing says so.
//
// Three links, all checked. A page nothing cites is the missing chapter. A rule file
// nothing routes to is the same failure from the other end — it exists, it is correct,
// and no agent will ever open it. And a route to a renamed page sends a reader nowhere.

const RULES_DIR = "docs/ai/rules";

assert("the rule files route to every opinions page", (failures) => {
  const brief = join(ROOT, "AGENTS.md");
  const rulesDir = join(ROOT, RULES_DIR);

  if (!existsSync(brief)) {
    failures.push("AGENTS.md is missing — it is the router every agent reads first");
    return null;
  }
  if (!existsSync(rulesDir)) {
    failures.push(`${RULES_DIR} is missing — AGENTS.md is a router with nothing to route to`);
    return null;
  }

  const ruleFiles = readdirSync(rulesDir).filter((f) => f.endsWith(".md"));
  if (ruleFiles.length === 0) {
    failures.push(`${RULES_DIR} holds no rule files`);
    return null;
  }

  // Three files may route to a rule file: the root brief, the docs/ai task router, and
  // the rulebook's own contents page. A file reachable from none of them exists, is
  // correct, and will never be opened.
  const briefSource = readFileSync(brief, "utf8");
  const routerPaths = [join(ROOT, "docs/ai/index.md"), join(rulesDir, "index.md")];
  const routers = [
    briefSource,
    ...routerPaths.filter(existsSync).map((f) => readFileSync(f, "utf8")),
  ].join(" ");

  // Every rule file is reachable. `index.md` is a router itself, so it is exempt from
  // needing a route into it beyond AGENTS.md, which is checked immediately after.
  for (const file of ruleFiles) {
    if (file === "index.md") continue;
    if (!routers.includes(file)) {
      failures.push(
        `${RULES_DIR}/${file} is routed to from none of AGENTS.md, docs/ai/index.md, or ${RULES_DIR}/index.md`,
      );
    }
  }

  if (!briefSource.includes("docs/ai/index.md") && !briefSource.includes(`${RULES_DIR}/index.md`)) {
    failures.push("AGENTS.md points at neither docs/ai/index.md nor the rulebook contents");
  }

  // CLAUDE.md `@`-imports every rule file, which is what makes the rulebook load at the
  // start of a session instead of when an agent thinks to go looking. A rule nobody
  // imports is the failure this whole assertion exists for, one layer up: it is routed
  // to, it is correct, and it silently stops being loaded. Skipped when CLAUDE.md is
  // absent — it is Claude Code's file, and deleting it is a supported choice that leaves
  // the routers above as the only path in.
  const claudeMd = join(ROOT, "CLAUDE.md");

  if (existsSync(claudeMd)) {
    const claudeSource = readFileSync(claudeMd, "utf8");
    const imported = new Set(
      [...claudeSource.matchAll(/^@(\S+\.md)\s*$/gm)].map((match) => match[1] ?? ""),
    );

    for (const file of ruleFiles) {
      if (file === "index.md") continue;
      if (!imported.has(`${RULES_DIR}/${file}`)) {
        failures.push(`CLAUDE.md does not @-import ${RULES_DIR}/${file}, so it never loads`);
      }
    }

    // An import naming a moved or deleted file fails silently — Claude Code inlines
    // nothing and says nothing, which is the same missing chapter from the other side.
    for (const target of imported) {
      if (!existsSync(join(ROOT, target))) {
        failures.push(`CLAUDE.md @-imports ${target}, which does not exist`);
      }
    }
  }

  // Every opinions page is cited by at least one rule file — the drift guard.
  const opinions = join(ROOT, "docs/opinions");
  if (!existsSync(opinions)) return "docs/opinions does not exist";

  // `index.md` is the human reading order, not a rule page — the digest replaces it
  // rather than pointing at it, so requiring a citation would be noise.
  const pages = readdirSync(opinions).filter((f) => f.endsWith(".md") && f !== "index.md");
  if (pages.length === 0) return "docs/opinions holds no pages";

  const digest = ruleFiles.map((f) => readFileSync(join(rulesDir, f), "utf8")).join("\n");

  for (const page of pages) {
    if (!digest.includes(`docs/opinions/${page}`)) {
      failures.push(`no file in ${RULES_DIR} cites docs/opinions/${page}`);
    }
  }

  // A route to a page that has been moved or renamed sends a reader somewhere that does
  // not exist, which is worse than no route at all. Both forms count: a backticked path
  // and a Markdown link target. Matching only the first is how deleting a rule file used
  // to pass — AGENTS.md links it as `](docs/ai/rules/folders.md)`, which the backtick
  // pattern never saw, and a second file citing the same opinions page hid the gap.
  const sources = [
    { name: rel(brief), text: briefSource, base: dirname(brief) },
    ...routerPaths
      .filter(existsSync)
      .map((f) => ({ name: rel(f), text: readFileSync(f, "utf8"), base: dirname(f) })),
    ...ruleFiles.map((f) => ({
      name: `${RULES_DIR}/${f}`,
      text: readFileSync(join(rulesDir, f), "utf8"),
      base: rulesDir,
    })),
  ];

  for (const { name, text, base } of sources) {
    const routed = new Set();

    for (const match of text.matchAll(/`(docs\/[A-Za-z0-9._/-]+\.md)`/g)) {
      routed.add(join(ROOT, match[1] ?? ""));
    }
    for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = match[1] ?? "";
      if (target.startsWith("http")) continue;
      routed.add(target.startsWith("docs/") ? join(ROOT, target) : resolve(base, target));
    }

    for (const path of routed) {
      if (!existsSync(path)) {
        failures.push(`${name} routes to ${rel(path)}, which does not exist`);
      }
    }
  }

  return null;
});

// ── 13 — every folder under docs/ has an index.md ───────────────────────────
//
// A folder with no index is a folder you can only navigate by listing it, and a reader
// who lands in one has to guess which file is the entry point. The same reasoning as
// the index.ts rule one level down: the index is what lets a page move within a folder
// without every link to the folder breaking.
//
// `reference/` folders are exempt by name. Their parent index.md names every page and
// meta.json carries the ordering, so an index inside would restate the parent and rot
// the first time a page landed in one and not the other. The exemption is by name
// rather than by location because docs/infra/reference/ now sits inside docs/ — the
// same folder role, and the same reason.

assert("every folder under `docs/` has an `index.md`", (failures) => {
  const root = join(ROOT, "docs");
  if (!existsSync(root)) return "docs/ does not exist";

  const folders = [root];

  // Appends while iterating, which the array iterator picks up -- a breadth-first walk
  // with no queue of its own.
  for (const folder of folders) {
    for (const entry of readdirSync(folder)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(folder, entry);
      if (statSync(full).isDirectory()) folders.push(full);
    }
  }

  for (const folder of folders) {
    if (basename(folder) === "reference") continue;

    // A folder holding no Markdown holds nothing an index could name.
    const pages = readdirSync(folder).filter((f) => f.endsWith(".md"));
    if (pages.length === 0) continue;

    if (!existsSync(join(folder, "index.md"))) {
      failures.push(`${rel(folder)} has ${pages.length} page(s) and no index.md`);
    }
  }

  return null;
});

// ── 14 — no comment block over two lines ─────────────────────────────────────
//
// docs/opinions/comments.md. A third consecutive line is an argument, and an
// argument belongs in the package's docs/reference/ where it gets reviewed as prose.

// A separator carries no prose and a pragma is instruction to a tool, so neither is
// a line a reader has to hold. Both end a run rather than extending it.
const COMMENT_EXEMPT = /^\/\/\s*(──|biome-ignore|eslint-disable|eslint-enable|@ts-)/;

const COMMENT_CEILING = 2;

assert("no comment block over two lines", (failures) => {
  for (const dir of sourceDirs()) {
    for (const file of sourceFiles(dir)) {
      const lines = readFileSync(file, "utf8").split("\n");
      let start = 0;
      let run = 0;

      const close = () => {
        if (run > COMMENT_CEILING) {
          failures.push(`${rel(file)}:${start} ${run}-line comment block — ceiling is two`);
        }
        run = 0;
      };

      lines.forEach((line, index) => {
        const trimmed = line.trim();

        if (!trimmed.startsWith("//") || COMMENT_EXEMPT.test(trimmed)) {
          close();
          return;
        }

        if (run === 0) start = index + 1;
        run += 1;
      });

      close();
    }
  }
});

// ── 15 — every path the docs name exists ────────────────────────────────────
//
// The cheapest class of documentation rot, and the one a reader trusts most: a path
// in backticks reads as a fact about the tree. `docs/setup/15` sent readers to
// `src/cache/` for two months, which is not a folder this repository has ever had.
//
// Only paths are checked, and a path is recognised conservatively — see PATH_SHAPE.
// A false positive here is worse than a miss: it teaches people to add exemptions.
//
// A `](target)` is checked too, and it is the half that rots silently: a backticked
// path is read, a link is clicked. Eight pages under `apps/*/docs/reference/` were one
// `../` short of `packages/` for months, and nothing in CI could see it.

const DOC_ROOTS = ["docs", "README.md", "AGENTS.md", "CLAUDE.md"];

// A backticked span that names a file or folder in this repository. It must contain a
// `/` or end in a known source extension, so `useState` and `owner` are not paths.
const PATH_SHAPE =
  /^(?:packages|apps|docs|tooling|infra|tasks|\.github|\.husky)\/[\w./@{},*$()[\]-]+$|^[\w.-]+\.(?:ts|tsx|mjs|mts|js|json|jsonc|md|css|sql|yml|yaml)$/;

// Written as a shape rather than a real path: a brace set, a glob, a route parameter,
// or an ellipsis is a description of several files and cannot be resolved to one.
const PATH_PLACEHOLDER = /[{}*<>]|\.\.\.|…|\$\{/;

// Real, and deliberately not on disk.
const PATH_EXEMPT = [
  // Both are named only as things that do not exist: the desktop shell doc 30
  // describes, and the Nest app `src/server/` would move to "if NestJS ever arrives".
  /^apps\/desktop/,
  /^apps\/api/,
  // A generated artefact, present only after a build.
  /^apps\/web\/src\/route-tree\.gen\.ts$/,
  /^apps\/web\/\.output\//,
  /\/dist\//,
  // Untracked by design.
  /^\.env$/,
  /\/\.env$/,
];

// A trailing `:12` or `:12-40` is a line reference, not part of the filename.
const stripLines = (path) => path.replace(/:\d+(?:[-,]\d+)*$/, "");

// A link target this repository does not own: a URL, a protocol-relative host, or a
// jump within the page. Everything else is a file somebody expects to be able to open.
const LINK_ELSEWHERE = /^(?:[a-z][\w+.-]*:|\/\/|#)/i;

function docFiles() {
  const out = [];

  for (const entry of DOC_ROOTS) {
    const full = join(ROOT, entry);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) out.push(...walk(full, [".md"]));
    else out.push(full);
  }

  for (const dir of sourceDirs()) {
    out.push(...walk(join(dir, "docs"), [".md"]));
  }

  // A plan names the files it is about to create, so its paths are promises, not facts.
  return out.filter((file) => !rel(file).startsWith("docs/plans/"));
}

// The package or app a doc belongs to, so `docs/reference/x.md` inside it resolves the
// way its reader does. `null` for the repository's own docs/, which have no owner.
function ownerOf(file) {
  for (const dir of sourceDirs()) {
    if (file.startsWith(`${dir}/`)) return dir;
  }
  return null;
}

assert("every path the docs name exists", (failures) => {
  for (const file of docFiles()) {
    const lines = outsideFences(readFileSync(file, "utf8"));

    lines.forEach((line, index) => {
      // Resolved against the page's own directory and nowhere else, because that is
      // what a renderer does. The backtick half below is looser on purpose — a span is
      // prose about the tree, a link is a door somebody walks through.
      for (const [, target] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = (target ?? "").split(/[#?]/)[0] ?? "";

        if (!href) continue;
        if (LINK_ELSEWHERE.test(href)) continue;
        if (PATH_PLACEHOLDER.test(href)) continue;
        if (existsSync(resolve(dirname(file), href))) continue;

        failures.push(`${rel(file)}:${index + 1} links to ${href}, which does not exist`);
      }

      for (const [, span] of line.matchAll(/`([^`\n]+)`/g)) {
        const candidate = stripLines(span.trim());

        if (PATH_PLACEHOLDER.test(candidate)) continue;
        if (!PATH_SHAPE.test(candidate)) continue;
        if (PATH_EXEMPT.some((pattern) => pattern.test(candidate))) continue;

        // A bare filename names a file whose folder the sentence around it supplies.
        if (!candidate.includes("/")) continue;

        // `docs/reference/x.md` means the page beside the doc that writes it, and the
        // opinions pages write it generically — "the package's `docs/reference/`".
        // So a `docs/…` span resolves against any package that has one, and only then
        // against the repository root.
        const owner = ownerOf(file);
        const roots = candidate.startsWith("docs/")
          ? [...(owner ? [owner] : []), ...sourceDirs(), ROOT]
          : [ROOT];

        if (!roots.some((base) => existsSync(join(base, candidate)))) {
          failures.push(`${rel(file)}:${index + 1} \`${candidate}\` does not exist`);
        }
      }
    });
  }

  // The other half, and the one nothing else covers: `docs/ai/rules/comments.md` tells an
  // author to say the constraint in the code and leave `// see docs/reference/x.md`, so a
  // page that was never written passes every check that walks `docs/` alone.
  //
  // Resolved against the *owning* package, unlike the doc half above. A doc page writing
  // `docs/reference/` is usually speaking generically; a source comment is a pointer a
  // reader follows from that file, so one meaning another package's page names the path.
  for (const dir of sourceDirs()) {
    for (const file of walk(join(dir, "src"), [".ts", ".tsx"])) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          // `(?<!:)` so the `//` of `https://` is not read as the start of a comment.
          const comment = line.search(/(?<!:)\/\//u);
          if (comment === -1) return;

          const text = line.slice(comment);

          // The escape the message below offers, checked: a comment that names the path
          // from the root rather than the package has to name one that is there.
          for (const [rooted] of text.matchAll(
            /\b(?:(?:packages|apps|tooling|infra)\/|docs\/(?!reference\/))[\w./-]+\.md\b/gu,
          )) {
            if (existsSync(join(ROOT, rooted))) continue;
            failures.push(`${rel(file)}:${index + 1} names ${rooted}, which does not exist`);
          }

          // Not preceded by a path separator: `packages/x/docs/reference/y.md` is a path
          // from the root, and the loop above resolves that one.
          for (const [, page] of text.matchAll(/(?<![\w/-])docs\/reference\/([a-z0-9-]+\.md)/gu)) {
            const name = page ?? "";
            if (existsSync(join(dir, "docs", "reference", name))) continue;

            const elsewhere = sourceDirs().find((other) =>
              existsSync(join(other, "docs", "reference", name)),
            );

            failures.push(
              `${rel(file)}:${index + 1} names docs/reference/${name}, which ` +
                (elsewhere ? `lives in ${rel(elsewhere)} — name the path` : "does not exist"),
            );
          }
        });
    }
  }
});

// ── 16 — the two pnpm version declarations agree ─────────────────────────────
//
// `pnpm/action-setup` reads `packageManager` and nothing else; pnpm 11 reads
// `devEngines.packageManager`. Both have to exist and say the same thing. See
// docs/setup/26-hygiene-and-ci.md.

assert("both pnpm version declarations agree", (failures) => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const modern = manifest.devEngines?.packageManager;
  const legacy = manifest.packageManager;

  // Declaring only the modern one is what left CI red on every branch for weeks: the
  // action fails in seconds with "No pnpm version is specified" and nothing runs.
  if (!legacy) {
    failures.push("package.json has no `packageManager` — `pnpm/action-setup` reads only that");
    return null;
  }
  if (!modern) {
    failures.push("package.json has no `devEngines.packageManager` — pnpm 11 reads only that");
    return null;
  }

  const expected = `${modern.name}@${modern.version}`;
  if (legacy !== expected) {
    failures.push(`packageManager is \`${legacy}\`, devEngines says \`${expected}\``);
  }

  return null;
});

// ── 17 — every unique index on a tenant table leads with organization_id ─────
//
// `roles_key_uq` on `(key)` alone means two tenants cannot both have an `owner`
// role, and the failure arrives as a duplicate-key error on someone else's signup.
// See docs/ai/rules/vocabulary.md.

// The two lookups that arrive holding no tenant: a request presents the token, or the
// hash, and nothing else, so the tenant is what the index is being used to find.
const TENANT_LEADING_EXEMPT = new Set(["invitations_token_uq", "api_keys_hash_uq"]);

assert("every unique index on a tenant table leads with `organization_id`", (failures) => {
  const blocks = pgTableBlocks();
  if (!blocks) return "packages/infrastructure has no schema files yet";

  for (const block of blocks) {
    const columns = columnsOf(block);
    // The quoted SQL name, never a substring: `last_active_organization_id` on `users`
    // ends with it and makes a table that carries no tenant look like one.
    const tenant = columns.find((column) => column.column === "organization_id")?.property;
    if (tenant === undefined) continue;

    for (const index of indexesOf(block)) {
      if (!index.unique) continue;
      if (TENANT_LEADING_EXEMPT.has(index.name)) continue;
      if (index.columns[0] === tenant) continue;

      failures.push(
        `${rel(block.file)}: "${index.name}" on ${block.table} leads with ` +
          `${index.columns[0] ?? "nothing"}, not organization_id`,
      );
    }
  }

  return null;
});

// ── 18 — every foreign key column has an index leading with it ───────────────
//
// Postgres does not index a foreign key, so an `ON DELETE CASCADE` with no index
// scans the whole child table. See docs/ai/rules/data.md.

assert("every foreign key column has an index leading with it", (failures) => {
  const blocks = pgTableBlocks();
  if (!blocks) return "packages/infrastructure has no schema files yet";

  for (const block of blocks) {
    const leading = new Set(
      indexesOf(block)
        .map((index) => index.columns[0])
        .filter(Boolean),
    );

    const byProperty = new Map(columnsOf(block).map((column) => [column.property, column.column]));

    // Both forms. A reference to a partitioned table has to be composite, which
    // `.references()` cannot express — and reading only that form stopped seeing them.
    const referencing = columnsOf(block)
      .filter((column) => column.isForeignKey)
      .map((column) => column.property);

    for (const columns of foreignKeysOf(block)) {
      const [first] = columns;
      if (first) referencing.push(first);
    }

    for (const property of referencing) {
      if (leading.has(property)) continue;

      failures.push(
        `${rel(block.file)}: ${block.table}.${byProperty.get(property) ?? property} is a ` +
          "foreign key with no index leading with it",
      );
    }
  }

  return null;
});

// ── 19 — every package with tests typechecks them ────────────────────────────
//
// A `tsconfig.json` that includes `src/**` only compiles the tests with nothing but
// vitest's transform, which erases types and checks none of them. A test double that
// falls behind its port then compiles, and passes for as long as nobody calls the
// method it never implemented. See docs/setup/26.

function typecheckConfig(dir) {
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return null;

  const script = JSON.parse(readFileSync(manifest, "utf8")).scripts?.typecheck;
  if (typeof script !== "string") return null;

  const named = /-p\s+(\S+)/.exec(script);
  return join(dir, named?.[1] ?? "tsconfig.json");
}

assert("every package with tests typechecks them", (failures) => {
  const roots = ["packages", "apps", "tooling"].map((name) => join(ROOT, name));
  let checked = 0;

  for (const base of roots.filter(existsSync)) {
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!existsSync(join(dir, "tests"))) continue;

      const config = typecheckConfig(dir);
      if (config === null) {
        failures.push(`${rel(dir)} has tests/ and no typecheck script to reach them`);
        continue;
      }
      if (!existsSync(config)) {
        failures.push(`${rel(dir)} typechecks against ${rel(config)}, which does not exist`);
        continue;
      }

      checked += 1;
      const include = JSON.parse(withoutComments(readFileSync(config, "utf8"))).include ?? [];

      if (!include.some((pattern) => pattern.startsWith("tests/"))) {
        failures.push(`${rel(config)} includes no tests/ pattern, so nothing typechecks them`);
      }
    }
  }

  if (checked === 0) return "no package has a tests/ directory";
  return null;
});

// ── 20 — every migration is safe on a table that already holds rows ──────────
//
// `pnpm db:generate` emits the unsafe form by default: `CREATE UNIQUE INDEX` over
// whatever is there, and `ADD COLUMN ... NOT NULL` with no default. Both are correct on
// an empty table and abort halfway through a deploy on a populated one. See
// docs/setup/13, "Writing a unique-index migration".

// Empty in lite: its baseline creates every table it indexes, so nothing predates the
// rule. The big kit exempts three migrations of its own history here.
const REPLAY_EXEMPT = new Map();

assert("every migration is safe on a table that already holds rows", (failures) => {
  const dir = join(ROOT, "packages/infrastructure/migrations");
  if (!existsSync(dir)) return "no migrations/ directory";

  const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  if (files.length === 0) return "migrations/ holds no .sql files";

  for (const file of files.sort()) {
    if (REPLAY_EXEMPT.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");

    // A table created in the same file holds no rows yet, so an index over it is safe
    // however it is written.
    const fresh = new Set(
      [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([a-z_]+)"/g)].map((m) => m[1]),
    );
    const deleted = new Set([...sql.matchAll(/DELETE FROM "([a-z_]+)"/g)].map((m) => m[1]));
    // The other way to de-dup, and the only one available to a **partial** index: an
    // `UPDATE` that moves the offending rows out of the predicate. Deleting the rows
    // would be the wrong repair when the duplicate is a flag rather than the row.
    const narrowed = new Set([...sql.matchAll(/UPDATE "([a-z_]+)" SET/g)].map((m) => m[1]));

    for (const match of sql.matchAll(/CREATE UNIQUE INDEX([^;]*?) ON "([a-z_]+)"([^;]*)/g)) {
      const [, , table = "", rest = ""] = match;
      if (fresh.has(table) || deleted.has(table)) continue;
      // An `UPDATE` counts only for a partial index. Over a full one it is not evidence
      // of anything: the duplicate rows are still there, still colliding.
      if (/\bWHERE\b/i.test(rest) && narrowed.has(table)) continue;
      failures.push(`${file} indexes ${table} uniquely with no de-dup before it`);
    }

    for (const match of sql.matchAll(/ALTER TABLE "([a-z_]+)" ADD COLUMN "([a-z_]+)"([^;]*)/g)) {
      const [, table = "", column = "", rest = ""] = match;
      if (fresh.has(table)) continue;
      if (!/\bNOT NULL\b/i.test(rest) || /\bDEFAULT\b/i.test(rest)) continue;
      failures.push(`${file} adds ${table}.${column} NOT NULL with no default`);
    }
  }

  return null;
});

// ── 21 — every partitioned table is on the allowlist, and every entry is real ─
//
// `PartitionedTable.ALL` is what the tenant seed walks, what the monthly schedule loops,
// and what the maintenance gateway's closed union derives from. A table partitioned in a
// migration but missing from that list gets no partitions for a new tenant, and the
// notice is a failed insert on their first write. The inverse is the same failure from
// the other side: an entry with no `PARTITION BY` anywhere names a table Postgres will
// reject every `ATTACH PARTITION` against. See docs/setup/13 and
// packages/infrastructure/docs/reference/partitions.md.

// The allowlist as `{ table -> { tenantKey, column } }`. Entries name their tables
// through module constants, so those are resolved first; a quoted literal is read
// directly. `null` on either key is a level the table does not have.
function partitionedAllowlist() {
  const file = join(ROOT, "packages/application/src/primitive/partitioned-table.ts");
  if (!existsSync(file)) return null;

  const source = readFileSync(file, "utf8");
  const constants = new Map(
    [...source.matchAll(/^const (\w+) = "([a-z_]+)";$/gm)].map((match) => [match[1], match[2]]),
  );

  const entries = new Map();
  const value = (raw) => (raw === "null" ? null : raw.slice(1, -1));

  // Tempered against the next `name:` so a malformed entry cannot take the following
  // one's keys, which is the same trap the migration parse below documents.
  const pattern =
    /\bname:\s*(\w+|"[a-z_]+")\s*,\s*(?:(?!name:)[\s\S])*?tenantKey:\s*(null|"[a-z_]+")\s*,\s*column:\s*(null|"[a-z_]+")/g;

  for (const match of source.matchAll(pattern)) {
    const [, token = "", tenantKey = "null", column = "null"] = match;
    const table = token.startsWith('"') ? token.slice(1, -1) : constants.get(token);
    if (table) entries.set(table, { tenantKey: value(tenantKey), column: value(column) });
  }

  return entries;
}

assert("every partitioned table is on the allowlist, with the same keys", (failures) => {
  const dir = join(ROOT, "packages/infrastructure/migrations");
  if (!existsSync(dir)) return "no migrations/ directory";

  const allowed = partitionedAllowlist();
  if (!allowed) return "packages/application has no partitioned-table.ts yet";
  if (allowed.size === 0) return "PartitionedTable.ALL parsed as empty";

  // What a migration declares, last file wins: a table dropped and recreated with a
  // different key is described by the statement that created it most recently.
  const declared = new Map();

  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(dir, file), "utf8");

    // The body is tempered against `CREATE TABLE` so the match cannot run past the end
    // of its own statement: a lazy `[\s\S]*?` binds the first table in the file to the
    // first `PARTITION BY` after it, which reported the wrong table name for 0017.
    for (const match of sql.matchAll(
      /CREATE TABLE "([a-z_]+)" \(((?:(?!CREATE TABLE)[\s\S])*?)\n\) PARTITION BY (LIST|RANGE) \("([a-z_]+)"\)/g,
    )) {
      const [, table = "", body = "", kind = "", column = ""] = match;
      declared.set(table, { file, body, kind, column });
    }

    for (const match of sql.matchAll(/PARTITION OF "?([a-z_]+)"?\s+DEFAULT/gi)) {
      failures.push(`${file} gives ${match[1]} a DEFAULT partition, which hides a missing month`);
    }
  }

  for (const [table, { file, body, kind, column }] of declared) {
    const entry = allowed.get(table);

    if (entry === undefined) {
      failures.push(`${file} partitions ${table}, which PartitionedTable.ALL does not name`);
      continue;
    }

    // A tenant level is `LIST (<tenantKey>)` and the month level under it is declared by
    // the seed at runtime, so a migration shows only the outermost key.
    const expected = entry.tenantKey ?? entry.column;
    const expectedKind = entry.tenantKey ? "LIST" : "RANGE";

    if (column !== expected || kind !== expectedKind) {
      failures.push(
        `${file} partitions ${table} by ${kind} (${column}); ` +
          `the allowlist says ${expectedKind} (${expected})`,
      );
    }

    // Postgres rejects a partitioned table whose primary key omits a partition key, so
    // this only ever fires on a migration nobody applied — which is the point.
    const key = body.match(/PRIMARY KEY\s*\(([^)]*)\)/i)?.[1] ?? "";
    for (const required of [entry.tenantKey, entry.column].filter(Boolean)) {
      if (!key.includes(`"${required}"`)) {
        failures.push(`${file}: ${table}'s primary key does not carry ${required}`);
      }
    }
  }

  for (const table of allowed.keys()) {
    if (declared.has(table)) continue;
    failures.push(`PartitionedTable.ALL names ${table}, which no migration partitions`);
  }

  return null;
});

// ── report ───────────────────────────────────────────────────────────────────

// ── 22 — a repository reads tables of one placement ──────────────────────────
//
// A repository whose tables span the catalog and a routed shard is one that cannot be
// split: on one node it works, and on two it reads half its rows from the wrong
// database. `BaseRepository` catches the transaction-level case at runtime; this
// catches the file-level case before anything runs. See
// packages/infrastructure/docs/reference/sharding.md.

// **Empty, and that is the point.** `22.10` split the one file that was in it, so this
// assertion guards a rule rather than recording an exception to one.
/** @type {ReadonlySet<string>} */
const CROSS_PLACEMENT_KNOWN = new Set();

assert("every repository reads tables of one placement", (failures) => {
  const dir = join(ROOT, "packages/infrastructure/src/pg");
  if (!existsSync(dir)) return "packages/infrastructure has no pg/ yet";

  const catalog = catalogTables();
  if (!catalog) return "packages/application has no shard.ts yet";

  // The two local tables, read from the same file the catalog list comes from: a
  // local table mixes with either placement, which is what `local` means.
  const shardFile = readFileSync(join(ROOT, "packages/application/src/primitive/shard.ts"), "utf8");
  const localBlock = shardFile.slice(shardFile.indexOf("const LOCAL = Object.freeze(["));
  const local = new Set(
    [...localBlock.slice(0, localBlock.indexOf("]")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]),
  );

  for (const file of walk(dir, [".ts"])) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("extends BaseRepository")) continue;
    if (CROSS_PLACEMENT_KNOWN.has(basename(file))) continue;

    // Every identifier imported from a schema module, mapped back to its table name
    // through the schema files themselves — the import name is camelCase.
    const imported = [...source.matchAll(/import \{([^}]*)\} from "[^"]*schema\/[a-z.-]+\.js";/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !name.startsWith("type "));

    const placements = new Set(
      imported
        .map((name) => tableNameOf(name))
        .filter((table) => table !== null && !local.has(table))
        .map((table) => (catalog.has(table) ? "catalog" : "routed")),
    );

    if (placements.size > 1) {
      failures.push(
        `${rel(file)}: reads ${[...placements].join(" and ")} tables — one repository, one placement`,
      );
    }
  }
});

// `notificationPreferences` -> `notification_preferences`, which is the convention
// every schema file follows: the export name is the table name in camelCase.
function tableNameOf(exported) {
  return exported.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// ── 23 — one place opens a pool ──────────────────────────────────────────────
//
// `DatabaseCluster` is what `close()` walks and what the health report counts. A second
// `new Database(` in `src/` is a pool nothing closes, nothing counts, and no shard map
// knows about. Scripts above `src/` open their own on purpose: they are one-shot.

assert("only `DatabaseCluster` opens a pool inside `src/`", (failures) => {
  const dir = join(ROOT, "packages/infrastructure/src");
  if (!existsSync(dir)) return "packages/infrastructure has no src/ yet";

  for (const file of walk(dir, [".ts"])) {
    if (basename(file) === "database-cluster.ts") continue;
    // Comments stripped first: `database.ts` documents the call it defines, and a
    // grep that counted prose would make the assertion unfixable.
    const code = readFileSync(file, "utf8").replaceAll(/^\s*\/\/.*$/gm, "");
    if (!code.includes("new Database(")) continue;

    failures.push(`${rel(file)}: opens a pool — only database-cluster.ts may`);
  }
});

// ── 24 — every declared event code has an emitter ────────────────────────────
//
// A code in the catalog that nothing emits is a dashboard panel which stays empty
// forever, and an empty panel reads exactly like a healthy system. Eight of
// twenty-four were in that state once; this is what keeps the drift from returning.

// Every fragment a catalog barrel spreads, resolved through the barrel's own imports, so
// a `...billingEvents` added tomorrow is covered without anyone editing this. `null` when
// the barrel is not there; an empty list when it spreads nothing.
function spreadFragments(dir) {
  const barrel = join(dir, "index.ts");
  if (!existsSync(barrel)) return null;

  const source = readFileSync(barrel, "utf8");
  const sources = new Map();

  for (const line of source.split("\n")) {
    const imported = /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/.exec(line);
    if (!imported) continue;

    for (const name of (imported[1] ?? "").split(",")) {
      const bare = name.replace("type ", "").trim();
      if (bare) sources.set(bare, imported[2] ?? "");
    }
  }

  const fragments = [];

  for (const spread of source.matchAll(/\.\.\.(\w+)/g)) {
    const from = sources.get(spread[1]);
    if (from) fragments.push(resolve(dir, from.replace(/\.js$/, ".ts")));
  }

  return { barrel, fragments };
}

assert("every event code in the catalog is emitted", (failures) => {
  const catalogDir = join(ROOT, "packages/observability/src/catalog");
  const spread = spreadFragments(catalogDir);
  if (!spread) return "packages/observability has no catalog barrel yet";

  const { barrel, fragments } = spread;
  if (fragments.length === 0) return "the catalog barrel spreads no fragment";

  const codes = new Set();

  for (const fragment of fragments) {
    if (!existsSync(fragment)) {
      failures.push(`${rel(barrel)}: spreads a fragment that is not on disk`);
      continue;
    }

    const source = withoutComments(readFileSync(fragment, "utf8"));
    for (const entry of source.matchAll(/^\s*"([a-z0-9._]+)":\s*\{/gm)) codes.add(entry[1]);
  }

  // `src/` only, so a spec emitting a code to assert the wire shape does not count as
  // the thing that ships it.
  const emitted = new Set();

  for (const dir of sourceDirs()) {
    for (const file of walk(join(dir, "src"), [".ts", ".tsx"])) {
      const source = readFileSync(file, "utf8");
      for (const call of source.matchAll(/\.emit\(\s*"([a-z0-9._]+)"/g)) emitted.add(call[1]);
    }
  }

  for (const code of [...codes].sort()) {
    if (emitted.has(code)) continue;
    failures.push(`${code}: declared in the catalog, emitted nowhere in any src/`);
  }
});

// ── 25 — `.env.example` and the app schemas say the same thing ────────────────
//
// `.env` is gitignored, so nothing can check it. What can be checked is the file
// somebody copies it from, and the failure this closes is the slow one: a key added
// to a schema, never documented, and absent from every `.env` copied before it.

// Read once and used both ways. Commented lines count: `.env.example` documents the
// optional keys by showing them commented out, which is still documenting them.
function exampleKeys() {
  const file = join(ROOT, ".env.example");
  if (!existsSync(file)) return null;

  const found = new Set();

  for (const line of readFileSync(file, "utf8").split("\n")) {
    const name = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (name?.[1]) found.add(name[1]);
  }

  return found;
}

// Every key an app's `Env` schema names: a field of the one `z.object({ … })` each schema
// declares, at two spaces bare or four inside a `.superRefine` chain.
function schemaKeys() {
  const apps = join(ROOT, "apps");
  if (!existsSync(apps)) return [];

  const found = [];

  for (const name of readdirSync(apps)) {
    const file = join(apps, name, "src/env.ts");
    if (!existsSync(file)) continue;

    for (const key of readFileSync(file, "utf8").matchAll(
      /^(?:\s{2}|\s{4})([A-Z][A-Z0-9_]*):\s/gm,
    )) {
      found.push({ app: name, key: key[1] ?? "" });
    }
  }

  return found;
}

// `APP` is deliberately absent: each process defaults it to its own name, and pinning it
// in a shared file makes every worker line claim to have come from the web app.
const UNDOCUMENTED = new Set(["APP"]);

// A numbered family — `DATABASE_SHARD_1_URL`, `_2_`, and so on — read by `shard-env.ts`
// rather than by a schema, so no literal key can appear in one.
const NOT_A_SCHEMA_KEY = /^DATABASE_SHARD_\d+_/;

// Every `${NAME:-default}` the compose file substitutes. Parsed rather than listed: a
// variable compose stops reading stops being exempt, which a hand-kept list cannot do.
function composeVariables() {
  const file = join(ROOT, "infra", "docker-compose.yml");
  if (!existsSync(file)) return new Map();

  const found = new Map();
  for (const match of readFileSync(file, "utf8").matchAll(/\$\{([A-Z0-9_]+):-([^}]*)\}/g)) {
    found.set(match[1] ?? "", match[2] ?? "");
  }

  return found;
}

// `WEB_PORT` is the one `.env.example` key compose does not read — `apps/web/vite.config.ts`
// does, and a config file is the other thing allowed to touch `process.env`.
const NOT_A_SCHEMA_KEY_ELSEWHERE = new Set(["WEB_PORT"]);

assert("`.env.example` documents every key an app requires", (failures) => {
  const example = exampleKeys();
  if (!example) return "no .env.example at the root";

  const schemas = schemaKeys();
  if (schemas.length === 0) return "no apps/*/src/env.ts to read";

  for (const { app, key } of schemas) {
    if (example.has(key) || UNDOCUMENTED.has(key)) continue;
    failures.push(`${key}: apps/${app}/src/env.ts requires it, .env.example does not mention it`);
  }

  // The other direction, and the reason it is here rather than in a second assertion:
  // a documented key nothing reads sends somebody to set a variable that does nothing.
  const declared = new Set(schemas.map((entry) => entry.key));

  // Read by `docker compose` or by a config file rather than by either schema, and
  // documented because `.env.example` is the file somebody edits when a port collides.
  const compose = composeVariables();

  for (const key of example) {
    if (declared.has(key) || NOT_A_SCHEMA_KEY.test(key)) continue;
    if (compose.has(key) || NOT_A_SCHEMA_KEY_ELSEWHERE.has(key)) continue;
    failures.push(`${key}: .env.example documents it, no app's env.ts reads it`);
  }
});

// ── 26 — every script above `src/` is typechecked ────────────────────────────
//
// A runnable script at a package root is code nothing imports, so nothing but `tsc`
// can notice when a signature under it moves. `platform-grant.ts` sat outside its own
// `include` and called a two-argument `TransactionScope.within` that had taken three
// for a phase — a `TypeError` at the moment somebody needed the first platform admin.

// `*.config.ts` is the exemption, and it is a category rather than a list: a tool config
// is consumed by its own tool, which supplies types this `tsconfig` does not name.
const TOOL_CONFIG = /\.config\.ts$/;

assert("every script above `src/` is in its package's tsconfig", (failures) => {
  const dirs = sourceDirs();
  if (dirs.length === 0) return "no packages or apps to read";

  for (const dir of dirs) {
    const config = join(dir, "tsconfig.json");
    if (!existsSync(config)) continue;

    const include = readFileSync(config, "utf8");

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".d.ts") || TOOL_CONFIG.test(file)) continue;
      if (include.includes(`"${file}"`)) continue;

      failures.push(`${rel(join(dir, file))}: not in ${rel(config)}, so nothing typechecks it`);
    }
  }
});

// ── 27 — every host port is stated once ──────────────────────────────────────
//
// A port is named twice by construction: `POSTGRES_PORT` is what compose publishes and
// `DATABASE_DIRECT_URL` is what dials it. Nothing used to hold the two together, so the
// stack came up on one port while every app reached for another, and the failure names
// neither — it is a connection refused, or worse, a different project's database.

// Each pair is `[port key, url key]`. A commented URL still counts: `.env.example`
// documents an optional key by showing it commented, and the port beside it is real.
const PORT_PAIRS = [
  ["POSTGRES_PORT", "DATABASE_DIRECT_URL"],
  ["POSTGRES_PORT", "DATABASE_URL"],
  ["REDIS_PORT", "REDIS_CACHE_URL"],
  ["REDIS_PORT", "REDIS_QUEUE_URL"],
  ["REDIS_PORT", "REDIS_REALTIME_URL"],
  ["SMTP_PORT", "SMTP_URL"],
  ["S3_PORT", "S3_ENDPOINT"],
  // Three URLs restate the web port, and a sign-in that fails because they disagree
  // reports a CORS or origin error naming none of them.
  ["WEB_PORT", "APP_BASE_URL"],
  ["WEB_PORT", "AUTH_URL"],
  ["WEB_PORT", "AUTH_TRUSTED_ORIGINS"],
];

// Values, including commented assignments — the same shape `exampleKeys` reads for §25.
function exampleValues() {
  const file = join(ROOT, ".env.example");
  if (!existsSync(file)) return null;

  const found = new Map();

  // Split on `\r?\n`, not `\n`. This file is CRLF on a Windows checkout, `.` does not
  // match `\r`, and a `$`-anchored value would then quietly capture nothing at all.
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match?.[1]) found.set(match[1], (match[2] ?? "").trim());
  }

  return found;
}

// The first `:<digits>` that is followed by `/` or end-of-value. A bare `host:port` with
// no path and a `scheme://host:port/db` both land here; `postgres://` does not.
function portOf(value) {
  const match = /:(\d{2,5})(?:\/|$|,)/.exec(value.replace(/^[a-z+]+:\/\//, ""));
  return match?.[1] ?? null;
}

assert("every host port is stated once", (failures) => {
  const values = exampleValues();
  if (!values) return "no .env.example at the root";

  for (const [portKey, urlKey] of PORT_PAIRS) {
    const port = values.get(portKey);
    const url = values.get(urlKey);
    if (!port || !url) continue;

    const stated = portOf(url);
    if (stated === null) {
      failures.push(`${urlKey}: names no port, so ${portKey} has nothing to agree with`);
    } else if (stated !== port) {
      failures.push(`${urlKey} dials :${stated}, ${portKey} publishes :${port}`);
    }
  }

  // The compose default is what a checkout with no `.env` gets — CI is exactly that —
  // so a default that disagrees with the template is a second answer to the same question.
  for (const [key, fallback] of composeVariables()) {
    const documented = values.get(key);
    if (documented && documented !== fallback) {
      failures.push(`${key}: compose defaults to ${fallback}, .env.example says ${documented}`);
    }
  }

  // One file, and this is what stops a second one coming back. `infra/.env` was read by
  // compose instead of the root file, and `packages/infrastructure/.env` layered under
  // five scripts through `dotenv`'s cwd lookup — both invisible, both holding ports.
  for (const dir of [join(ROOT, "infra"), ...sourceDirs()]) {
    const stray = join(dir, ".env");
    if (existsSync(stray)) {
      failures.push(`${rel(stray)}: the only env file is the one at the root`);
    }
  }
});

// ── 28 — every permission in the catalog gates a procedure ────────────────
//
// §24 from the other vocabulary. A key nothing asserts is a checkbox in the role editor
// that grants nothing — an administrator ticks it, a member is told they have the right,
// and every call still fails. Phase 5's own exit criterion, checked for the first time.

// Registered ahead of the procedure that will assert it, so the seed grants it once
// rather than per deploy. Each line names the item that removes it; the list only shrinks.
// ──
// **Empty since `24.2`**, which landed the procedure for `platform.shards.manage`.
/** @type {ReadonlySet<string>} */
const PERMISSION_AWAITING_A_PROCEDURE = new Set();

assert("every permission in the catalog gates a procedure", (failures) => {
  const declared = spreadFragments(join(ROOT, "packages/permissions/src/catalog"));
  if (!declared) return "packages/permissions has no catalog barrel yet";
  if (declared.fragments.length === 0) return "the permission barrel spreads no fragment";

  const gates = spreadFragments(join(ROOT, "packages/contracts/src/catalog"));
  if (!gates) return "packages/contracts has no procedure-permission barrel yet";

  // The module comes off the entry rather than the key's first segment, because that is
  // what `CapabilitySet.can()` reads: a `core` key is held by every resolved principal
  // without a role granting it, so no procedure asserts it and none should.
  const keys = new Map();

  for (const fragment of declared.fragments) {
    if (!existsSync(fragment)) {
      failures.push(`${rel(declared.barrel)}: spreads a fragment that is not on disk`);
      continue;
    }

    const source = withoutComments(readFileSync(fragment, "utf8"));
    for (const [, key, body] of source.matchAll(/"([a-z0-9._]+)":\s*\{([^}]*)\}/g)) {
      keys.set(key, /module:\s*"(\w+)"/.exec(body ?? "")?.[1] ?? "");
    }
  }

  if (keys.size === 0) return `${rel(declared.barrel)} declares no permission`;

  // Every value in `PROCEDURE_PERMISSIONS`. The keys are procedure paths, which is the
  // direction `procedure-permissions.spec.ts` covers.
  const gated = new Set();

  for (const fragment of gates.fragments) {
    if (!existsSync(fragment)) continue;
    const source = withoutComments(readFileSync(fragment, "utf8"));
    for (const [, key] of source.matchAll(/"[\w.]+":\s*"([a-z0-9._]+)"/g)) gated.add(key);
  }

  for (const [key, module] of [...keys].sort()) {
    if (module === "core") continue;
    if (PERMISSION_AWAITING_A_PROCEDURE.has(key)) continue;
    if (gated.has(key)) continue;

    failures.push(`${key}: declared in the catalog, asserted by no procedure`);
  }
});

// ── 29 — the four shard readers run one algorithm ──────────────────────
//
// `DATABASE_SHARD_<n>_URL` is parsed in four places and cannot be parsed in one: each
// app declares the environment it needs (docs/setup/25), and the scripts above
// `packages/infrastructure/src` cannot import an app. So the copies stay and the rule
// does not — two of them once disagreed about an empty value, and the odd one out threw
// an error naming shard 1 as its own missing predecessor.

const SHARD_READERS = [
  "apps/web/src/env.ts",
  "apps/worker/src/env.ts",
  "apps/realtime/src/env.ts",
  "packages/infrastructure/shard-env.ts",
];

// The body only. The infrastructure copy names its return type where the three apps inline
// it, which is a difference in the signature and not in what the code does.
function shardReaderBody(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return null;

  const source = withoutComments(readFileSync(path, "utf8"));
  const start = source.indexOf("const shardsFromEnv =");
  if (start < 0) return null;

  const open = source.indexOf("=> {", start);
  if (open < 0) return null;

  const end = source.indexOf("\n};", open);
  if (end < 0) return null;

  return source
    .slice(open + 4, end)
    .replace(/\s+/g, " ")
    .trim();
}

assert("the four shard readers run one algorithm", (failures) => {
  const bodies = new Map();
  let present = 0;

  for (const file of SHARD_READERS) {
    if (!existsSync(join(ROOT, file))) continue;
    present += 1;

    // On disk and holding no reader: the copy was deleted or renamed, which is the other
    // way this rule stops being checked.
    const body = shardReaderBody(file);
    if (body === null || body.length === 0) {
      failures.push(`${file}: no \`shardsFromEnv\` to compare`);
      continue;
    }

    bodies.set(file, body);
  }

  if (present === 0) return "no shard reader on disk";
  if (bodies.size < 2) return "fewer than two shard readers to compare";

  const [reference, ...rest] = [...bodies];
  if (!reference) return;

  for (const [file, body] of rest) {
    if (body !== reference[1]) {
      failures.push(`${file}: parses shards differently from ${reference[0]}`);
    }
  }
});

// ── 30 — absent in lite: it checked widget placement, and widgets left with LT1.2.
// docs/scale/widgets.md restores it with them.

// ── 31 — every flag is live ────────────────────────────────────────────────
//
// A flag is a rollout, and a rollout ends: the code keeps one branch and the flag is
// deleted. One past its `expiresOn` has become a permanent fork nobody is reviewing, and
// one that no code reads switches nothing — both are debt the build should say out loud.

assert("every flag is live", (failures) => {
  const flagDir = join(ROOT, "packages/permissions/src/flag");
  const declared = spreadFragments(flagDir);
  if (!declared) return "packages/permissions has no flag barrel yet";

  const flags = new Map();
  for (const fragment of declared.fragments) {
    if (!existsSync(fragment)) {
      failures.push(`${rel(declared.barrel)}: spreads a fragment that is not on disk`);
      continue;
    }
    const source = withoutComments(readFileSync(fragment, "utf8"));
    for (const [, key, body] of source.matchAll(/"([a-z0-9._-]+)":\s*\{([^}]*)\}/g)) {
      flags.set(key, /expiresOn:\s*"(\d{4}-\d{2}-\d{2})"/.exec(body ?? "")?.[1] ?? "");
    }
  }

  // Zero flags passes rather than skips: no rollout in flight is the state to reach.
  if (flags.size === 0) return;

  // UTC, as the dates are written: a flag expiring today is live until tomorrow everywhere.
  const today = new Date().toISOString().slice(0, 10);
  const sources = sourceDirs()
    .flatMap((dir) => walk(join(dir, "src"), [".ts", ".tsx"]))
    .filter((file) => !file.startsWith(flagDir))
    .map((file) => withoutComments(readFileSync(file, "utf8")));

  for (const [key, expiresOn] of [...flags].sort()) {
    if (!expiresOn) failures.push(`${key}: declares no \`expiresOn\``);
    else if (expiresOn < today)
      failures.push(`${key}: expired on ${expiresOn} — ship one branch and delete it`);

    if (!sources.some((source) => source.includes(`"${key}"`))) {
      failures.push(`${key}: no code outside the flag fragments reads it`);
    }
  }
});

// ── 32 — no colour outside the twelve ──────────────────────────────────────
//
// Tailwind's palette is reset to the twelve, so `bg-red-500` generates nothing, but an
// arbitrary value compiles: `text-[#fff]` is a colour no theme knows and `check:contrast`
// never sees. The same holds for a literal in a `style` prop or in any stylesheet outside
// `style/color/`. `style/token.css` may write `oklch(0 0 0 / <alpha>)` for a shadow, and only that.

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOUR_UTILITY = new RegExp(
  String.raw`\b(?:bg|text|border(?:-[trblxy])?|ring|outline|fill|stroke|decoration|accent|caret|divide|placeholder|shadow|from|via|to)-(?:\[(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\()|(?:white|black)\b|(?:${PALETTE})-\d{2,3}\b)`,
);
const STYLE_COLOUR =
  /\b(?:color|background|backgroundColor|borderColor|outlineColor|fill|stroke)\s*:\s*["'`](?!var\()/;
const CSS_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklab|lab|lch|hwb)\(|\boklch\(/;

assert("no colour outside the twelve", (failures) => {
  const roots = ["packages/ui/src", "packages/feature/src", "apps/web/src"].map((dir) =>
    join(ROOT, dir),
  );

  for (const file of roots.flatMap((root) => walk(root, [".ts", ".tsx"]))) {
    if (/\.gen\.tsx?$/.test(file)) continue;
    const lines = withoutComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      const hit = COLOUR_UTILITY.exec(line)?.[0] ?? STYLE_COLOUR.exec(line)?.[0];
      if (hit) failures.push(`${rel(file)}:${index + 1}: \`${hit}\` is not one of the twelve`);
    });
  }

  const colourDir = join(ROOT, "packages/ui/src/style/color");
  const shadow = join(ROOT, "packages/ui/src/style/token.css");
  for (const file of roots.flatMap((root) => walk(root, [".css"]))) {
    if (file.startsWith(colourDir)) continue;
    // `/* */` is CSS's only comment, and prose about a colour is not one.
    const lines = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n");
    lines.forEach((line, index) => {
      const text = file === shadow ? line.replaceAll(/oklch\(0 0 0 \/ [\d.]+\)/g, "") : line;
      const hit = CSS_COLOUR.exec(text)?.[0];
      if (hit) failures.push(`${rel(file)}:${index + 1}: \`${hit}\` is a literal colour`);
    });
  }
});

let failed = 0;
let skippedCount = 0;

for (const { name, failures, skipped } of results) {
  if (failures.length > 0) {
    failed += 1;
    console.log(`✗ ${name}`);
    for (const detail of failures) console.log(`    ${detail}`);
  } else if (skipped) {
    skippedCount += 1;
    console.log(`○ ${name} — skipped: ${skipped}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed} of ${results.length} assertions failed.`);
  process.exit(1);
}

const passed = results.length - skippedCount;

if (skippedCount === 0) {
  console.log(`\n${passed} assertions passed.`);
  process.exit(0);
}

// Counted apart, never summed: a skip is an assertion that did not run, and printing
// "16 assertions passed" over two `○` lines is how an unbuilt artefact reads as green.
console.log(`\n${passed} passed, ${skippedCount} skipped, of ${results.length}.`);

// Locally a skip is a fast loop; in CI it is a check nobody ran and nobody will.
if (process.env.CI === "true") {
  console.log("A skipped assertion is unverified. Build the artefacts it needs first.");
  process.exit(1);
}
