// The ClickHouse migrator. `infra/clickhouse.init.sql` ran only on an empty volume and
// never on a managed instance, so the derived store's schema was frozen at first boot:
// a materialized column or a second table had no path at all. This is that path.
//
// A no-op with a printed sentence when `CLICKHOUSE_URL` is unset, because the store is
// opt-in twice over and a migrator that failed without it would break every other run.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ClickHouseConnection } from "./src/clickhouse/index.js";

const DIR = join(import.meta.dirname, "clickhouse-migrations");

// `MergeTree ORDER BY version` rather than a `ReplacingMergeTree`: a version applied
// twice is a bug to see, not a duplicate to collapse.
const VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations
(
  version    UInt32,
  name       String,
  applied_at DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY version`;

// `<version>_<name>.sql`, the same shape drizzle writes. A file the pattern does not
// match is an error rather than a guess.
const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

// **Not `sql.split(";")`.** The first file's own comments contain a semicolon — "Postgres
// keeps thirteen months and archives the rest to S3; this is where …" — and splitting
// naively cut the `CREATE TABLE` in half, in a comment, with a parse error naming neither.
//
// So: a scanner that knows where a semicolon cannot end a statement. Line comments,
// block comments and single-quoted strings, which is every construct these files use.
export const statementsOf = (sql: string): readonly string[] => {
  const out: string[] = [];
  let start = 0;

  for (let at = 0; at < sql.length; at += 1) {
    const two = sql.slice(at, at + 2);

    if (two === "--") {
      const end = sql.indexOf("\n", at);
      at = end === -1 ? sql.length : end;
      continue;
    }

    if (two === "/*") {
      const end = sql.indexOf("*/", at + 2);
      at = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (sql[at] === "'") {
      // `\\'` is ClickHouse's escape, so a backslash swallows whatever follows it —
      // including the quote that would otherwise close the literal.
      at += 1;
      while (at < sql.length && sql[at] !== "'") at += sql[at] === "\\" ? 2 : 1;
      continue;
    }

    if (sql[at] === ";") {
      out.push(sql.slice(start, at));
      start = at + 1;
    }
  }

  out.push(sql.slice(start));

  // A chunk that is only comments and whitespace is not a statement, and ClickHouse
  // rejects an empty body with a 400 rather than ignoring it.
  return out
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(?:--[^\n]*\s*)+$/.test(statement));
};

export const migrationOf = (file: string, sql: string): Migration => {
  const match = FILE.exec(file);
  if (!match?.[1] || !match[2]) throw new Error(`Not a migration filename: ${file}`);

  return { version: Number(match[1]), name: match[2], statements: statementsOf(sql) };
};

// Read here rather than through `env.ts`: this is a script above `src/`, the one
// category allowed to read the environment directly.
const named = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required when CLICKHOUSE_URL is set.`);
  return value;
};

const main = async (): Promise<void> => {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) {
    console.log("CLICKHOUSE_URL is unset, so there is no analytics store to migrate.");
    console.log("Set it and re-run, or start one with `pnpm infra:up:analytics`.");
    return;
  }

  const connection = new ClickHouseConnection({
    url,
    // Named explicitly, the rule both `env.ts` schemas enforce: a default here is either
    // a credential baked into shipped code or one that cannot reach the local container.
    database: named("CLICKHOUSE_DATABASE"),
    username: named("CLICKHOUSE_USER"),
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
  });

  await connection.command(VERSION_TABLE);

  const applied = new Set(
    (await connection.query<{ version: number }>("SELECT version FROM schema_migrations")).map(
      (row) => row.version,
    ),
  );

  const pending = readdirSync(DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => migrationOf(file, readFileSync(join(DIR, file), "utf8")))
    .filter((migration) => !applied.has(migration.version));

  if (pending.length === 0) {
    console.log(`clickhouse: nothing to do, ${applied.size} applied`);
    await connection.close();
    return;
  }

  for (const migration of pending) {
    // One `command()` per statement: the HTTP interface takes one statement per request,
    // and a whole file sent at once fails on the second semicolon.
    for (const statement of migration.statements) await connection.command(statement);

    // Recorded after, never before: a crash mid-file leaves the version unrecorded and
    // the re-run replays it, which every statement here is written to survive.
    await connection.command(
      `INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, '${migration.name}')`,
    );

    console.log(`clickhouse: applied ${migration.version} ${migration.name}`);
  }

  await connection.close();
  console.log(`clickhouse: ${pending.length} applied`);
};

// Guarded so a spec can import the splitter without connecting to anything — the same
// shape `partition-ddl.ts` uses, and for the same reason.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
