// Each assertion run against a tree that violates it, and against one that does not.
//
// The script derives ROOT from its own location, so a fixture is a temporary tree with a
// copy of it under `tooling/scripts/` — no ROOT parameter to thread through thirty-one
// assertions, and the thing under test is the file the repository actually runs.

// @ts-check

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPIED = ["check-architecture.mjs", "source-text.mjs"];
const made = [];

// A package is a directory under `packages/` with a manifest -- that is what makes it one
// to `packageDirs()`, and a fixture without the manifest is a directory nothing walks.
const PKG = (name) =>
  JSON.stringify({
    name: `@fixture/${name}`,
    private: true,
    scripts: { typecheck: "tsc --noEmit" },
  });

// Enough of a repository that every assertion either passes or skips. A test adds the one
// file that breaks the one it is about, so a failure elsewhere is never ambient.
const BASE = {
  "package.json": JSON.stringify({
    packageManager: "pnpm@10.17.0",
    devEngines: { packageManager: { name: "pnpm", version: "10.17.0" } },
  }),
  "pnpm-workspace.yaml": [
    "catalog:",
    '  "@orpc/client": ^1.9.3',
    '  "@orpc/server": ^1.9.3',
    "",
  ].join("\n"),
  "AGENTS.md":
    "Start at docs/ai/index.md. The rulebook is [layering](docs/ai/rules/layering.md).\n",
  "CLAUDE.md": "@docs/ai/rules/layering.md\n",
  "docs/index.md": "Docs.\n",
  // Relative, not `docs/ai/rules/…`: §12 resolves a root-anchored target from the root,
  // §15 resolves every target the way a renderer does, and only one of those is a link
  // that works from inside `docs/ai/`.
  "docs/ai/index.md": "Router. [layering](rules/layering.md)\n",
  "docs/ai/rules/index.md": "Contents. [layering](layering.md)\n",
  "docs/ai/rules/layering.md": "Dependencies point one way. See docs/opinions/layering.md.\n",
  "docs/opinions/index.md": "Opinions.\n",
  "docs/opinions/layering.md": "The argument.\n",
  "packages/application/package.json": PKG("application"),
  "packages/application/src/index.ts": 'export const NAME = "application";\n',
  // §9 derives its exemption set from this file and §22 reads it for placements, so a
  // fixture without it makes both skip rather than run.
  "packages/application/src/primitive/shard.ts":
    'const CATALOG = Object.freeze(["organizations", "users"] as const);\n' +
    'const LOCAL = Object.freeze(["activity_log"] as const);\n',
};

function parse(output) {
  const results = [];
  let current = null;

  for (const line of output.split("\n")) {
    const match = /^([✓✗○]) (.+?)(?: — skipped: .+)?$/u.exec(line);
    if (match) {
      current = { name: match[2] ?? "", status: match[1] ?? "", details: "" };
      results.push(current);
      continue;
    }
    if (current && line.startsWith("    ")) current.details += `${line.trim()}\n`;
  }

  return results;
}

function run(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-architecture-"));
  made.push(root);

  for (const [path, body] of Object.entries({ ...BASE, ...files })) {
    if (body === null) continue;
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }

  const scripts = join(root, "tooling/scripts");
  mkdirSync(scripts, { recursive: true });
  for (const name of COPIED) cpSync(join(SCRIPTS, name), join(scripts, name));

  let output = "";
  try {
    output = execFileSync("node", [join(scripts, "check-architecture.mjs")], {
      encoding: "utf8",
    });
  } catch (error) {
    // A non-zero exit is a failing assertion, and under CI=true also a skipped one. The
    // per-assertion lines are on stdout either way, which is the whole of what is read.
    output = error instanceof Error && "stdout" in error ? String(error.stdout) : "";
  }

  return parse(output);
}

function entry(results, name) {
  const found = results.find((result) => result.name === name);
  expect(found, `no assertion named ${name} in the output`).toBeDefined();
  return found;
}

function passes(results, name) {
  expect(entry(results, name).status, `${name} should pass`).toBe("✓");
}

function fails(results, name, detail) {
  const found = entry(results, name);
  expect(found.status, `${name} should fail — details: ${found.details}`).toBe("✗");
  expect(found.details).toContain(detail);
}

afterAll(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

const SCHEMA_BARREL = 'export { tasks } from "./task.schema.js";\n';

function schema(body) {
  return {
    "packages/infrastructure/src/pg/schema/index.ts": SCHEMA_BARREL,
    "packages/infrastructure/src/pg/schema/task.schema.ts": body,
  };
}

describe("the fixture harness", () => {
  it("reports every assertion, and none of them fails on a clean tree", () => {
    const results = run();

    expect(results).toHaveLength(30);
    for (const { name, status } of results) {
      expect(status, `${name} failed on the base fixture`).not.toBe("✗");
    }
  });
});

describe("1 — application imports no framework", () => {
  it("catches a framework named in the domain", () => {
    fails(
      run({ "packages/application/src/index.ts": 'import { eq } from "drizzle-orm";\n' }),
      "`application` imports no framework",
      "drizzle-orm",
    );
  });

  it("allows the same name in another package", () => {
    passes(
      run({
        "packages/infrastructure/package.json": PKG("infrastructure"),
        "packages/infrastructure/src/index.ts": 'import { eq } from "drizzle-orm";\n',
      }),
      "`application` imports no framework",
    );
  });
});

describe("2 — application does not log", () => {
  it("catches an observability import", () => {
    fails(
      run({
        "packages/application/src/index.ts":
          'import { Logger } from "@loadbearing/observability";\n',
      }),
      "`application` does not log",
      "@loadbearing/observability",
    );
  });
});

describe("3 — only env.ts reads process.env", () => {
  it("catches a read outside env.ts", () => {
    fails(
      run({ "packages/application/src/index.ts": "export const url = process.env.DB_URL;\n" }),
      "only `env.ts` reads `process.env`",
      "reads process.env",
    );
  });

  it("does not count a comment naming it", () => {
    passes(
      run({ "packages/application/src/index.ts": "// never read process.env here\nexport {};\n" }),
      "only `env.ts` reads `process.env`",
    );
  });

  it("exempts a config at a package root but not a file merely named like one", () => {
    passes(
      run({ "packages/application/vitest.config.ts": "export default { url: process.env.X };\n" }),
      "only `env.ts` reads `process.env`",
    );
    fails(
      run({ "packages/application/src/container.config.ts": "export const x = process.env.X;\n" }),
      "only `env.ts` reads `process.env`",
      "container.config.ts",
    );
  });
});

describe("4 — every @orpc entry is on one version line", () => {
  it("catches two version lines", () => {
    fails(
      run({
        "pnpm-workspace.yaml": [
          "catalog:",
          '  "@orpc/client": ^1.9.3',
          '  "@orpc/server": ^1.8.0',
          "",
        ].join("\n"),
      }),
      "every `@orpc/*` entry is on one version line",
      "2 version lines",
    );
  });

  it("ignores a commented entry", () => {
    passes(
      run({
        "pnpm-workspace.yaml": [
          "catalog:",
          '  "@orpc/client": ^1.9.3',
          '  # "@orpc/server": ^1.8.0',
          "",
        ].join("\n"),
      }),
      "every `@orpc/*` entry is on one version line",
    );
  });
});

describe("5 — comments are //, never a block", () => {
  it("catches a block comment and the JSX form", () => {
    fails(
      run({ "packages/application/src/index.ts": "/* a block */\nexport {};\n" }),
      "comments are `//`, never a block",
      "block comment",
    );
    fails(
      run({ "packages/application/src/index.tsx": "{/* jsx */}\nexport {};\n" }),
      "comments are `//`, never a block",
      "block comment",
    );
  });

  it("does not count a glob inside a string", () => {
    passes(
      run({ "packages/application/src/index.ts": 'export const g = "**/dist/**";\n' }),
      "comments are `//`, never a block",
    );
  });
});

describe("6 — no top-level await in a built barrel", () => {
  it("catches an indented top-level await, not only one at column zero", () => {
    fails(
      run({ "packages/application/dist/index.js": "  await init();\nexport {};\n" }),
      "no top-level await in a built barrel",
      "top-level await",
    );
  });

  it("allows one inside a function", () => {
    passes(
      run({ "packages/application/dist/index.js": "async function f() {\n  await init();\n}\n" }),
      "no top-level await in a built barrel",
    );
  });
});

describe('7 — "use client" only in ui, query, feature', () => {
  it("catches it in an isomorphic package and allows it in ui", () => {
    fails(
      run({ "packages/application/src/index.ts": '"use client";\nexport {};\n' }),
      '`"use client"` only in ui, query, feature',
      "must not declare a client boundary",
    );
    passes(
      run({
        "packages/ui/package.json": PKG("ui"),
        "packages/ui/src/index.ts": '"use client";\nexport {};\n',
      }),
      '`"use client"` only in ui, query, feature',
    );
  });
});

describe("9 — every domain table declares organization_id", () => {
  it("catches a table without one", () => {
    fails(
      run(
        schema(
          'export const tasks = pgTable("tasks", {\n' +
            '  id: uuid("id").primaryKey(),\n' +
            "});\n",
        ),
      ),
      "every domain table declares `organization_id`",
      "tasks",
    );
  });

  it("does not accept a column that merely ends with the name", () => {
    fails(
      run(
        schema(
          'export const tasks = pgTable("tasks", {\n' +
            '  active: uuid("active_organization_id"),\n' +
            "});\n",
        ),
      ),
      "every domain table declares `organization_id`",
      "tasks",
    );
  });

  it("accepts the column itself", () => {
    passes(
      run(
        schema(
          'export const tasks = pgTable("tasks", {\n' +
            '  organizationId: uuid("organization_id").notNull(),\n' +
            "});\n",
        ),
      ),
      "every domain table declares `organization_id`",
    );
  });
});

describe("10 — the audit port is ActivityLogger", () => {
  it("catches the old name", () => {
    fails(
      run({ "packages/application/src/index.ts": "export type AuditTrail = never;\n" }),
      "the audit port is `ActivityLogger`, never `AuditTrail`",
      "AuditTrail",
    );
  });
});

describe("11 — the schema barrel names every schema file", () => {
  it("catches a schema file the barrel omits", () => {
    fails(
      run({
        "packages/infrastructure/src/pg/schema/index.ts": SCHEMA_BARREL,
        "packages/infrastructure/src/pg/schema/task.schema.ts": "export const tasks = 1;\n",
        "packages/infrastructure/src/pg/schema/user.schema.ts": "export const users = 1;\n",
      }),
      "the schema barrel names every `*.schema.ts`",
      "user.schema",
    );
  });
});

describe("12 — the rule files route to every opinions page", () => {
  it("catches an opinions page no rule file cites", () => {
    fails(
      run({ "docs/opinions/files.md": "The argument.\n" }),
      "the rule files route to every opinions page",
      "docs/opinions/files.md",
    );
  });

  it("catches a rule file CLAUDE.md does not import", () => {
    fails(
      run({
        "docs/ai/rules/files.md": "Kebab-case. See docs/opinions/files.md.\n",
        "docs/opinions/files.md": "The argument.\n",
        "docs/ai/index.md": "Router. [layering](rules/layering.md) [files](rules/files.md)\n",
      }),
      "the rule files route to every opinions page",
      "does not @-import",
    );
  });

  it("catches a Markdown link to a page that does not exist", () => {
    fails(
      run({ "docs/ai/rules/layering.md": "See docs/opinions/layering.md and [gone](gone.md).\n" }),
      "the rule files route to every opinions page",
      "which does not exist",
    );
  });
});

describe("13 — every folder under docs has an index.md", () => {
  it("catches a folder with a page and no index", () => {
    fails(
      run({ "docs/setup/02-environment.md": "Setup.\n" }),
      "every folder under `docs/` has an `index.md`",
      "docs/setup",
    );
  });

  it("exempts a reference folder", () => {
    passes(
      run({ "docs/reference/palette.md": "Palette.\n" }),
      "every folder under `docs/` has an `index.md`",
    );
  });
});

describe("14 — no comment block over two lines", () => {
  it("catches three consecutive comment lines", () => {
    fails(
      run({ "packages/application/src/index.ts": "// one\n// two\n// three\nexport {};\n" }),
      "no comment block over two lines",
      "index.ts",
    );
  });

  it("allows two, and lets a separator end a run", () => {
    passes(
      run({ "packages/application/src/index.ts": "// one\n// two\nexport {};\n" }),
      "no comment block over two lines",
    );
    passes(
      run({
        "packages/application/src/index.ts": "// one\n// two\n// ── x ──\n// three\nexport {};\n",
      }),
      "no comment block over two lines",
    );
  });
});

describe("15 — every path the docs name exists", () => {
  const NAME = "every path the docs name exists";

  it("catches a path that names nothing, and ignores one inside a fence", () => {
    fails(
      run({ "docs/index.md": "See `packages/nowhere/src/index.ts`.\n" }),
      NAME,
      "packages/nowhere/src/index.ts",
    );
    passes(run({ "docs/index.md": "```\n`packages/nowhere/src/index.ts`\n```\n" }), NAME);
  });

  // The link half. A backticked path is prose about the tree; a link is a door, and the
  // eight that were one `../` short of `packages/` rendered as links the whole time.
  it("catches a link target that resolves nowhere", () => {
    fails(
      run({ "docs/setup/index.md": "See [ports](../../packages/application/docs/ports.md).\n" }),
      NAME,
      "../../packages/application/docs/ports.md",
    );
  });

  it("resolves a target against the page's own directory, not the root", () => {
    passes(
      run({
        "docs/setup/index.md": "See [layering](../ai/rules/layering.md).\n",
      }),
      NAME,
    );
    fails(
      run({ "docs/setup/index.md": "See [layering](docs/ai/rules/layering.md).\n" }),
      NAME,
      "docs/ai/rules/layering.md",
    );
  });

  it("leaves a URL, an anchor and a shape alone", () => {
    passes(
      run({
        "docs/index.md":
          "[a](https://example.test/x.md) [b](#section) [c](mailto:x@y.test)" +
          " [d](packages/{a,b}/index.md)\n",
      }),
      NAME,
    );
  });

  // The source half. `comments.md` tells an author to leave `// see docs/reference/x.md`
  // and let the page carry the why, so a page nobody wrote passes every `docs/` walk.
  const commented = (body) => ({ "packages/application/src/index.ts": body });

  it("catches a comment naming a reference page the package does not have", () => {
    fails(
      run(commented("// See docs/reference/nowhere.md.\nexport const A = 1;\n")),
      NAME,
      "nowhere.md",
    );
  });

  it("accepts one the package does have", () => {
    passes(
      run({
        ...commented("// See docs/reference/ports.md.\nexport const A = 1;\n"),
        "packages/application/docs/reference/ports.md": "Ports.\n",
      }),
      NAME,
    );
  });

  // The message offers "name the path" as the fix for a page in another package, so the
  // path a comment names has to be checked too, or the fix is an unchecked escape.
  it("checks a root-relative path a comment names", () => {
    fails(
      run(commented("// See packages/nowhere/docs/reference/ports.md.\nexport const A = 1;\n")),
      NAME,
      "packages/nowhere/docs/reference/ports.md",
    );
    passes(
      run({
        ...commented("// See packages/other/docs/reference/ports.md.\nexport const A = 1;\n"),
        "packages/other/package.json": PKG("other"),
        "packages/other/docs/reference/ports.md": "Ports.\n",
      }),
      NAME,
    );
  });

  it("does not read a URL as a comment, or a path outside one", () => {
    passes(run(commented('export const A = "https://x/docs/reference/nowhere.md";\n')), NAME);
  });
});

describe("16 — both pnpm version declarations agree", () => {
  it("catches a disagreement", () => {
    fails(
      run({
        "package.json": JSON.stringify({
          packageManager: "pnpm@10.17.0",
          devEngines: { packageManager: { name: "pnpm", version: "10.16.0" } },
        }),
      }),
      "both pnpm version declarations agree",
      "10.16.0",
    );
  });
});

describe("17 — every unique index on a tenant table leads with organization_id", () => {
  const table = (extras) =>
    schema(
      'export const tasks = pgTable("tasks", {\n' +
        '  id: uuid("id").primaryKey(),\n' +
        '  organizationId: uuid("organization_id").notNull(),\n' +
        '  key: text("key").notNull(),\n' +
        `}, (t) => [${extras}]);\n`,
    );

  it("catches a unique index that leads with anything else", () => {
    fails(
      run(table('uniqueIndex("tasks_key_uq").on(t.key)')),
      "every unique index on a tenant table leads with `organization_id`",
      "tasks_key_uq",
    );
  });

  it("accepts one that leads with the tenant, and ignores a plain index", () => {
    passes(
      run(table('uniqueIndex("tasks_key_uq").on(t.organizationId, t.key)')),
      "every unique index on a tenant table leads with `organization_id`",
    );
    passes(
      run(table('index("tasks_key_idx").on(t.key)')),
      "every unique index on a tenant table leads with `organization_id`",
    );
  });
});

function migration(sql) {
  return { "packages/infrastructure/migrations/0100_probe.sql": sql };
}

describe("20 — every migration is safe on a table that already holds rows", () => {
  it("catches a unique index over a table the file does not create", () => {
    fails(
      run(migration('CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");\n')),
      "every migration is safe on a table that already holds rows",
      "no de-dup",
    );
  });

  it("catches a NOT NULL column with no default", () => {
    fails(
      run(migration('ALTER TABLE "roles" ADD COLUMN "slug" text NOT NULL;\n')),
      "every migration is safe on a table that already holds rows",
      "NOT NULL with no default",
    );
  });

  it("accepts the de-dup, a table created in the same file, and a default", () => {
    passes(
      run(
        migration(
          'DELETE FROM "roles" a USING "roles" b WHERE a."key" = b."key";\n' +
            'CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");\n',
        ),
      ),
      "every migration is safe on a table that already holds rows",
    );
    passes(
      run(
        migration(
          'CREATE TABLE "tags" ("id" uuid PRIMARY KEY);\n' +
            'CREATE UNIQUE INDEX "tags_key_uq" ON "tags" USING btree ("key");\n',
        ),
      ),
      "every migration is safe on a table that already holds rows",
    );
    passes(
      run(migration('ALTER TABLE "roles" ADD COLUMN "slug" text DEFAULT \'\' NOT NULL;\n')),
      "every migration is safe on a table that already holds rows",
    );
  });
});

describe("19 — every package with tests typechecks them", () => {
  const withTests = (config) => ({
    "packages/application/tsconfig.json": JSON.stringify(config),
    "packages/application/tests/probe.spec.ts": "export {};\n",
  });

  it("catches a config that includes src only", () => {
    fails(
      run(withTests({ include: ["src/**/*.ts"] })),
      "every package with tests typechecks them",
      "includes no tests/ pattern",
    );
  });

  it("catches a package with tests and no typecheck script", () => {
    fails(
      run({
        "packages/application/package.json": JSON.stringify({ name: "@fixture/application" }),
        "packages/application/tests/probe.spec.ts": "export {};\n",
      }),
      "every package with tests typechecks them",
      "no typecheck script",
    );
  });

  it("accepts a config that includes them, and follows a named -p file", () => {
    passes(
      run(withTests({ include: ["src/**/*.ts", "tests/**/*.ts"] })),
      "every package with tests typechecks them",
    );
    passes(
      run({
        "packages/application/package.json": JSON.stringify({
          name: "@fixture/application",
          scripts: { typecheck: "tsc --noEmit -p tsconfig.test.json" },
        }),
        "packages/application/tsconfig.json": JSON.stringify({ include: ["src/**/*.ts"] }),
        "packages/application/tsconfig.test.json": JSON.stringify({
          include: ["src/**/*.ts", "tests/**/*.ts"],
        }),
        "packages/application/tests/probe.spec.ts": "export {};\n",
      }),
      "every package with tests typechecks them",
    );
  });
});

describe("18 — every foreign key column has an index leading with it", () => {
  const table = (extras) =>
    schema(
      'export const tasks = pgTable("tasks", {\n' +
        '  organizationId: uuid("organization_id").notNull(),\n' +
        '  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),\n' +
        `}, (t) => [${extras}]);\n`,
    );

  it("catches a foreign key no index leads with", () => {
    fails(
      run(table('index("tasks_org_idx").on(t.organizationId)')),
      "every foreign key column has an index leading with it",
      "owner_id",
    );
  });

  it("is not satisfied by an index that merely mentions it", () => {
    fails(
      run(table('index("tasks_pair_idx").on(t.organizationId, t.ownerId)')),
      "every foreign key column has an index leading with it",
      "owner_id",
    );
  });

  it("accepts an index leading with it", () => {
    passes(
      run(table('index("tasks_owner_idx").on(t.ownerId, t.organizationId)')),
      "every foreign key column has an index leading with it",
    );
  });

  // The composite form, which a reference to a partitioned table has to take. Reading
  // only `.references()` stopped seeing these columns the moment the first one landed.
  const composite = (extras) =>
    schema(
      'export const tasks = pgTable("tasks", {\n' +
        '  organizationId: uuid("organization_id").notNull(),\n' +
        '  goalId: uuid("goal_id").notNull(),\n' +
        `}, (t) => [foreignKey({ columns: [t.goalId, t.organizationId], foreignColumns: [goals.id, goals.organizationId], name: "tasks_goal_fk" }), ${extras}]);\n`,
    );

  it("catches a composite foreign key no index leads with", () => {
    fails(
      run(composite('index("tasks_org_idx").on(t.organizationId)')),
      "every foreign key column has an index leading with it",
      "goal_id",
    );
  });

  it("accepts a composite foreign key whose leading column is indexed", () => {
    passes(
      run(composite('index("tasks_goal_fk_idx").on(t.goalId)')),
      "every foreign key column has an index leading with it",
    );
  });
});

describe("21 — every partitioned table is on the allowlist, with the same keys", () => {
  const ALLOWLIST = "packages/application/src/primitive/partitioned-table.ts";
  const NAME = "every partitioned table is on the allowlist, with the same keys";

  // The two shapes the parser has to read: a name written through a module constant, and
  // one written as a literal. Both appear in the real file.
  const allowlist = (entries) =>
    'const ACTIVITY_LOG = "activity_log";\n' +
    `const ALL = Object.freeze([${entries}] as const);\n`;

  // A table with both levels. The month level under it is declared by the tenant seed at
  // runtime, so the migration shows only the outermost key.
  const TENANT = (name) =>
    `{ name: ${name}, tenantKey: "organization_id", column: "occurred_at", retentionMonths: null },`;

  const MONTH = (name) =>
    `{ name: ${name}, tenantKey: null, column: "occurred_at", retentionMonths: 2 },`;

  const migration = (body) => ({
    "packages/infrastructure/migrations/0000_base.sql": body,
  });

  const CREATE = (table, kind, key, pk) =>
    `CREATE TABLE "${table}" (\n` +
    `\t"id" uuid NOT NULL,\n` +
    `\tCONSTRAINT "${table}_pk" PRIMARY KEY(${pk})\n` +
    `) PARTITION BY ${kind} ("${key}");\n`;

  const TENANT_DDL = (table) =>
    CREATE(table, "LIST", "organization_id", `"id","organization_id","occurred_at"`);

  const MONTH_DDL = (table) => CREATE(table, "RANGE", "occurred_at", `"id","occurred_at"`);

  it("catches a migration partitioning a table the allowlist does not name", () => {
    fails(
      run({
        [ALLOWLIST]: allowlist(TENANT("ACTIVITY_LOG")),
        ...migration(TENANT_DDL("activity_log") + MONTH_DDL("outbox_event")),
      }),
      NAME,
      "which PartitionedTable.ALL does not name",
    );
  });

  it("catches an allowlist entry no migration partitions", () => {
    fails(
      run({
        [ALLOWLIST]: allowlist(TENANT("ACTIVITY_LOG") + MONTH('"outbox_event"')),
        ...migration(TENANT_DDL("activity_log")),
      }),
      NAME,
      "which no migration partitions",
    );
  });

  // The level the migration declares is the outermost one, so a tenant entry written as
  // `RANGE` is a table whose months would be created directly under the parent.
  it("catches a migration that declares the wrong level", () => {
    fails(
      run({
        [ALLOWLIST]: allowlist(TENANT("ACTIVITY_LOG")),
        ...migration(MONTH_DDL("activity_log")),
      }),
      NAME,
      "the allowlist says LIST (organization_id)",
    );
  });

  // Postgres rejects this itself, so it only ever fires on a migration nobody applied —
  // which is the window this assertion exists to close.
  it("catches a primary key that omits a partition key", () => {
    fails(
      run({
        [ALLOWLIST]: allowlist(TENANT("ACTIVITY_LOG")),
        ...migration(CREATE("activity_log", "LIST", "organization_id", '"id","occurred_at"')),
      }),
      NAME,
      "primary key does not carry organization_id",
    );
  });

  it("catches a DEFAULT partition, which hides a missing month", () => {
    fails(
      run({
        [ALLOWLIST]: allowlist(TENANT("ACTIVITY_LOG")),
        ...migration(
          TENANT_DDL("activity_log") +
            'CREATE TABLE "activity_log_default" PARTITION OF "activity_log" DEFAULT;\n',
        ),
      }),
      NAME,
      "DEFAULT partition",
    );
  });

  // The last statement wins: a table dropped and recreated with a different key is
  // described by the migration that created it most recently.
  it("accepts a migration and an allowlist that agree, at either level", () => {
    passes(
      run({
        [ALLOWLIST]: allowlist(TENANT("ACTIVITY_LOG") + MONTH('"outbox_event"')),
        ...migration(TENANT_DDL("activity_log") + MONTH_DDL("outbox_event")),
      }),
      NAME,
    );
  });
});

describe("22 — every repository reads tables of one placement", () => {
  const NAME = "every repository reads tables of one placement";

  // The import shape the assertion reads: a repository names its tables through the
  // schema modules, and the export name is the table name in camelCase.
  const repository = (imports) => ({
    "packages/infrastructure/src/pg/repository/pg-probe.repository.ts": `${imports}\nexport class PgProbeRepository extends BaseRepository {}\n`,
  });

  it("accepts a repository that reads only catalog tables", () => {
    passes(
      run(repository('import { organizations, users } from "../schema/rbac.schema.js";')),
      NAME,
    );
  });

  it("accepts a repository that reads only routed tables", () => {
    passes(run(repository('import { tasks, notes } from "../schema/task.schema.js";')), NAME);
  });

  // The whole point: on one node it works, and on two it reads half its rows from the
  // wrong database.
  it("catches a repository that spans the catalog and a routed shard", () => {
    fails(
      run(repository('import { organizations, tasks } from "../schema/rbac.schema.js";')),
      NAME,
      "one repository, one placement",
    );
  });

  // `local` is on every node, so it mixes with either and is not a crossing.
  it("accepts a local table beside a catalog one", () => {
    passes(
      run(repository('import { activityLog, organizations } from "../schema/rbac.schema.js";')),
      NAME,
    );
  });
});

describe("23 — only DatabaseCluster opens a pool inside src/", () => {
  const NAME = "only `DatabaseCluster` opens a pool inside `src/`";

  it("accepts the cluster opening pools", () => {
    passes(
      run({
        "packages/infrastructure/src/pg/primitive/database-cluster.ts":
          "const one = new Database({ url });\n",
      }),
      NAME,
    );
  });

  it("catches a second place opening one", () => {
    fails(
      run({
        "packages/infrastructure/src/pg/repository/pg-probe.repository.ts":
          "const sneaky = new Database({ url });\n",
      }),
      NAME,
      "only database-cluster.ts may",
    );
  });

  // `database.ts` documents the call it defines; a grep that counted prose would make
  // the assertion unfixable.
  it("ignores the call named in a comment", () => {
    passes(
      run({
        "packages/infrastructure/src/pg/primitive/database.ts":
          "// a script that writes new Database({ url }) gets the same pool\n",
      }),
      NAME,
    );
  });
});

describe("24 — every event code in the catalog is emitted", () => {
  const NAME = "every event code in the catalog is emitted";

  const BARREL = [
    'import { coreEvents } from "./core.events.js";',
    "",
    "export const EVENT_CATALOG = {",
    "  ...coreEvents,",
    "} as const;",
    "",
  ].join("\n");

  // The barrel plus one fragment, which is the shape the assertion resolves through.
  function catalog(fragment, extra = {}) {
    return {
      "packages/observability/package.json": PKG("observability"),
      "packages/observability/src/catalog/index.ts": BARREL,
      "packages/observability/src/catalog/core.events.ts": fragment,
      ...extra,
    };
  }

  const ONE_CODE = 'export const coreEvents = {\n  "queue.job.failed": { level: "error" },\n};\n';

  it("catches a code the catalog declares and nothing emits", () => {
    fails(run(catalog(ONE_CODE)), NAME, "queue.job.failed");
  });

  it("accepts a code emitted from another package's src/", () => {
    passes(
      run(
        catalog(ONE_CODE, {
          "packages/infrastructure/package.json": PKG("infrastructure"),
          "packages/infrastructure/src/queue/consumer.ts":
            'logger.emit("queue.job.failed", { queue, jobId, attempt });\n',
        }),
      ),
      NAME,
    );
  });

  // A spec emitting a code to assert its wire shape is not the thing that ships it.
  it("does not count a spec as the emitter", () => {
    fails(
      run(
        catalog(ONE_CODE, {
          "packages/infrastructure/package.json": PKG("infrastructure"),
          "packages/infrastructure/tests/queue/consumer.spec.ts":
            'logger.emit("queue.job.failed", { queue, jobId, attempt });\n',
        }),
      ),
      NAME,
      "queue.job.failed",
    );
  });

  // The fragment list comes from the barrel's imports, so a second one is covered with
  // no edit to the script.
  it("reads a second fragment the barrel spreads", () => {
    fails(
      run(
        catalog(ONE_CODE, {
          "packages/observability/src/catalog/index.ts": BARREL.replace(
            "...coreEvents,",
            "...coreEvents,\n  ...billingEvents,",
          ).replace(
            'import { coreEvents } from "./core.events.js";',
            'import { billingEvents } from "./billing.events.js";\nimport { coreEvents } from "./core.events.js";',
          ),
          "packages/observability/src/catalog/billing.events.ts":
            'export const billingEvents = {\n  "billing.invoice.issued": { level: "info" },\n};\n',
          "packages/infrastructure/package.json": PKG("infrastructure"),
          "packages/infrastructure/src/queue/consumer.ts":
            'logger.emit("queue.job.failed", { queue, jobId, attempt });\n',
        }),
      ),
      NAME,
      "billing.invoice.issued",
    );
  });

  // Nothing to check is not the same as nothing wrong: without a catalog the assertion
  // says so rather than passing.
  it("skips a tree with no catalog barrel", () => {
    const found = entry(run(), NAME);
    expect(found.status).toBe("○");
  });
});

describe("25 — .env.example documents every key an app requires", () => {
  const NAME = "`.env.example` documents every key an app requires";

  // One schema key and one documented key, which is the smallest tree that can drift in
  // either direction.
  function tree(example, schema) {
    return {
      ".env.example": example,
      "apps/web/src/env.ts": `const Env = z.object({\n${schema}\n});\n`,
    };
  }

  const ONE_KEY = "    DATABASE_URL: z.url(),";

  it("accepts a schema and an example that say the same thing", () => {
    passes(run(tree("DATABASE_URL=postgres://localhost/x\n", ONE_KEY)), NAME);
  });

  it("catches a key the schema requires and the example never mentions", () => {
    fails(run(tree("# nothing here\n", ONE_KEY)), NAME, "DATABASE_URL");
  });

  // The other direction, and the reason it is one assertion: a documented key nothing
  // reads sends somebody to set a variable that does nothing.
  it("catches a documented key no schema reads", () => {
    fails(run(tree("DATABASE_URL=x\nLONG_GONE=1\n", ONE_KEY)), NAME, "LONG_GONE");
  });

  // Commented out is still documented: that is how the example carries an optional key.
  it("counts a commented line as documentation", () => {
    passes(run(tree("# DATABASE_URL=postgres://localhost/x\n", ONE_KEY)), NAME);
  });

  // Each process defaults `APP` to its own name. Pinning it in a shared file makes every
  // worker line claim to have come from the web app.
  it("allows `APP` to be undocumented on purpose", () => {
    passes(run(tree("DATABASE_URL=x\n", `${ONE_KEY}\n    APP: z.string(),`)), NAME);
  });

  // A numbered family, read by `shard-env.ts` rather than by a schema, so no literal key
  // can appear in one.
  it("allows the numbered shard family in the example", () => {
    passes(run(tree("DATABASE_URL=x\n# DATABASE_SHARD_1_URL=y\n", ONE_KEY)), NAME);
  });

  // Read by `docker compose` and by `apps/web/vite.config.ts`, never by a schema, and
  // documented because the example is the file somebody edits when a port collides.
  it("allows a host port in the example that no schema reads", () => {
    // Derived from the compose file rather than from a name pattern, so the fixture
    // needs the file the exemption is read out of.
    const withCompose = {
      ...tree("DATABASE_URL=x\nPOSTGRES_PORT=25432\n", ONE_KEY),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: compose's own interpolation, which a template literal would resolve away
      "infra/docker-compose.yml": 'ports: ["${POSTGRES_PORT:-25432}:5432"]\n',
    };

    passes(run(withCompose), NAME);
  });

  it("skips a tree with no example to compare against", () => {
    expect(entry(run(), NAME).status).toBe("○");
  });
});

describe("26 — every script above src/ is typechecked", () => {
  const NAME = "every script above `src/` is in its package's tsconfig";

  const CONFIG = (include) =>
    JSON.stringify({ extends: "@loadbearing/tsconfig/library.json", include });

  it("accepts a root script the tsconfig names", () => {
    passes(
      run({
        "packages/application/tsconfig.json": CONFIG(["src/**/*.ts", "seed.ts"]),
        "packages/application/seed.ts": "export const seeded = true;\n",
      }),
      NAME,
    );
  });

  // The failure this exists for: a script nothing imports, so nothing but `tsc` can
  // notice when a signature under it moves.
  it("catches a root script the tsconfig leaves out", () => {
    fails(
      run({
        "packages/application/tsconfig.json": CONFIG(["src/**/*.ts"]),
        "packages/application/seed.ts": "export const seeded = true;\n",
      }),
      NAME,
      "seed.ts",
    );
  });

  // A category, not a list: a tool config is consumed by its own tool, which supplies
  // types the package's `tsconfig` does not name.
  it("exempts a tool config", () => {
    passes(
      run({
        "packages/application/tsconfig.json": CONFIG(["src/**/*.ts"]),
        "packages/application/drizzle.config.ts": "export default {};\n",
        "packages/application/vitest.config.ts": "export default {};\n",
      }),
      NAME,
    );
  });

  it("ignores a declaration file, which is types rather than code", () => {
    passes(
      run({
        "packages/application/tsconfig.json": CONFIG(["src/**/*.ts"]),
        "packages/application/web.d.ts": "declare const x: number;\n",
      }),
      NAME,
    );
  });

  it("says nothing about a package with no tsconfig of its own", () => {
    passes(
      run({
        "packages/application/seed.ts": "export const seeded = true;\n",
        "packages/application/tsconfig.json": null,
      }),
      NAME,
    );
  });
});

describe("27 — every host port is stated once", () => {
  const NAME = "every host port is stated once";

  // biome-ignore lint/suspicious/noTemplateCurlyInString: compose's own interpolation, which a template literal would resolve away
  const COMPOSE = 'services:\n  loki:\n    ports: ["${LOKI_PORT:-23100}:3100"]\n';

  // One port key and the URL beside it, which is the smallest tree that can drift.
  const pair = (published, dialled) => ({
    ".env.example": `POSTGRES_PORT=${published}\nDATABASE_DIRECT_URL=postgres://u:p@localhost:${dialled}/db\n`,
  });

  it("accepts a port key and the URL beside it agreeing", () => {
    passes(run(pair("25432", "25432")), NAME);
  });

  it("catches a URL dialling a port nothing publishes", () => {
    fails(run(pair("25432", "5432")), NAME, "DATABASE_DIRECT_URL");
  });

  // The example is CRLF on a Windows checkout, and `.` matches no carriage return, so a
  // `$`-anchored value captures nothing and the assertion passes on everything.
  it("reads a CRLF example, which is what a Windows checkout has", () => {
    const crlf = {
      ".env.example":
        "POSTGRES_PORT=25432\r\nDATABASE_DIRECT_URL=postgres://u:p@localhost:5432/db\r\n",
    };
    fails(run(crlf), NAME, "DATABASE_DIRECT_URL");
  });

  // Commented out is still documented, and the port beside it is still published.
  it("checks a commented URL too", () => {
    const tree = { ".env.example": "SMTP_PORT=21025\n# SMTP_URL=smtp://localhost:1025\n" };
    fails(run(tree), NAME, "SMTP_URL");
  });

  // CI has no `.env`, so the compose default is what CI gets. One that disagrees with
  // the template is a second answer to the same question.
  it("catches a compose default that disagrees with the example", () => {
    const tree = {
      ".env.example": "LOKI_PORT=23100\n",
      "infra/docker-compose.yml": COMPOSE.replace("23100", "3100"),
    };
    fails(run(tree), NAME, "LOKI_PORT");
  });

  it("accepts a compose default that matches", () => {
    const tree = { ".env.example": "LOKI_PORT=23100\n", "infra/docker-compose.yml": COMPOSE };
    passes(run(tree), NAME);
  });

  // The two that existed: compose read `infra/.env` rather than the root file, and
  // `dotenv`'s cwd lookup layered `packages/infrastructure/.env` under five scripts.
  it("catches a second env file coming back", () => {
    const tree = { ".env.example": "LOKI_PORT=23100\n", "infra/.env": "LOKI_PORT=3100\n" };
    fails(run(tree), NAME, "infra/.env");
  });

  it("skips a tree with no example to compare against", () => {
    expect(entry(run(), NAME).status).toBe("○");
  });
});

describe("28 — every permission in the catalog gates a procedure", () => {
  const NAME = "every permission in the catalog gates a procedure";

  const catalogs = (declared, gated) => ({
    "packages/permissions/package.json": PKG("permissions"),
    "packages/permissions/src/catalog/index.ts":
      'import { memberPermissions } from "./member.permissions.js";\n' +
      "export const CATALOG = { ...memberPermissions } as const;\n",
    "packages/permissions/src/catalog/member.permissions.ts": `export const memberPermissions = {${declared}} as const;\n`,
    "packages/contracts/package.json": PKG("contracts"),
    "packages/contracts/src/catalog/index.ts":
      'import { memberProcedurePermissions } from "./member.permissions.js";\n' +
      "export const PROCEDURE_PERMISSIONS = { ...memberProcedurePermissions };\n",
    "packages/contracts/src/catalog/member.permissions.ts": `export const memberProcedurePermissions = {${gated}} as const;\n`,
  });

  const INVITE = '"member.invite": { scope: "org", module: "member", label: "Invite" },';

  it("catches a key no procedure asserts", () => {
    fails(run(catalogs(INVITE, "")), NAME, "member.invite");
  });

  it("accepts one a procedure asserts", () => {
    passes(run(catalogs(INVITE, '"member.invite": "member.invite",')), NAME);
  });

  // Held by every resolved principal in `CapabilitySet.can()` rather than through a role,
  // so no procedure asserts it. Read off the entry, not off the key's first segment.
  it("exempts a core key by its module, not by its name", () => {
    passes(
      run(catalogs('"member.audit": { scope: "org", module: "core", label: "Audit" },', "")),
      NAME,
    );
    fails(
      run(catalogs('"core.audit": { scope: "org", module: "member", label: "Audit" },', "")),
      NAME,
      "core.audit",
    );
  });

  it("skips a tree with no permission catalog", () => {
    expect(entry(run(), NAME).status).toBe("○");
  });
});

describe("29 — the four shard readers run one algorithm", () => {
  const NAME = "the four shard readers run one algorithm";

  // The rule all four carry, written once here. A fixture varies one copy of it.
  const reader = (guard) =>
    [
      "const shardsFromEnv = () => {",
      "  const found = [];",
      "  for (const [name, value] of Object.entries(process.env)) {",
      "    const match = /^DATABASE_SHARD_(d+)_URL$/.exec(name);",
      "    if (!match?.[1] || !value) continue;",
      "    const index = Number(match[1]);",
      `    if (index < ${guard}) continue;`,
      "    found.push({ index, url: value });",
      "  }",
      "  return found.toSorted((left, right) => left.index - right.index);",
      "};",
      "",
    ].join("\n");

  const trees = (web, worker, script, realtime = 1) => ({
    "apps/web/package.json": PKG("web"),
    "apps/web/src/env.ts": reader(web),
    "apps/worker/package.json": PKG("worker"),
    "apps/worker/src/env.ts": reader(worker),
    "apps/realtime/package.json": PKG("realtime"),
    "apps/realtime/src/env.ts": reader(realtime),
    "packages/infrastructure/package.json": PKG("infrastructure"),
    "packages/infrastructure/shard-env.ts": reader(script),
  });

  it("accepts four copies of one rule", () => {
    passes(run(trees(1, 1, 1)), NAME);
  });

  // The fourth copy, which the comment and this fixture once left out.
  it("catches the realtime copy parsing differently", () => {
    fails(run(trees(1, 1, 1, 0)), NAME, "apps/realtime/src/env.ts");
  });

  // The drift that happened: the scripts' copy and the apps' copies disagreed about an
  // empty value, and the odd one out threw naming shard 1 as its own predecessor.
  it("catches one copy that parses differently", () => {
    fails(run(trees(1, 1, 0)), NAME, "packages/infrastructure/shard-env.ts");
  });

  // A comment is not a difference. `withoutComments` runs first, which is what lets each
  // copy explain itself where it sits.
  it("ignores a comment one copy carries and the others do not", () => {
    const tree = trees(1, 1, 1);
    tree["apps/web/src/env.ts"] = reader(1).replace(
      "  const found = [];",
      "  // Node 0 is `DATABASE_URL`.\n  const found = [];",
    );
    passes(run(tree), NAME);
  });

  it("catches a copy that no longer holds the reader at all", () => {
    const tree = trees(1, 1, 1);
    tree["apps/worker/src/env.ts"] = "export const Env = {};\n";
    fails(run(tree), NAME, "apps/worker/src/env.ts");
  });

  it("skips a tree with no shard reader on it", () => {
    expect(entry(run(), NAME).status).toBe("○");
  });
});

describe("31 — every flag is live", () => {
  const NAME = "every flag is live";

  const flags = (entries) => ({
    "packages/permissions/package.json": PKG("permissions"),
    "packages/permissions/src/flag/index.ts":
      'import { exampleFlags } from "./example.flags.js";\n' +
      "export const FLAGS = { ...exampleFlags } as const;\n",
    "packages/permissions/src/flag/example.flags.ts": `export const exampleFlags = {${entries}} as const;\n`,
  });

  const flag = (expiresOn) =>
    `"example.rollout": { owner: "sami", expiresOn: "${expiresOn}", description: "An example" },`;

  const reader = {
    "packages/application/src/example/update.use-case.ts":
      'export const check = (flags) => flags.assertOn("example.rollout");\n',
  };

  it("accepts a flag in date that code reads", () => {
    passes(run({ ...flags(flag("2999-12-31")), ...reader }), NAME);
  });

  it("catches a flag past its expiry", () => {
    fails(run({ ...flags(flag("2000-01-01")), ...reader }), NAME, "expired on 2000-01-01");
  });

  // A reader only in a comment reads nothing, and the declaration itself is not a reader.
  it("catches a flag no code reads", () => {
    fails(
      run({
        ...flags(flag("2999-12-31")),
        "packages/application/src/example/update.use-case.ts": '// "example.rollout"\n',
      }),
      NAME,
      "no code outside the flag fragments reads it",
    );
  });

  // No rollout in flight is the state to reach, so it passes rather than skips.
  it("passes with no flag at all, and skips a tree with no flag barrel", () => {
    passes(run(flags("")), NAME);
    expect(entry(run(), NAME).status).toBe("○");
  });
});
