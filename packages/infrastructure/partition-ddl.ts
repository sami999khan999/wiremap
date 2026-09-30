// The second half of `db:generate`. Drizzle cannot express `PARTITION BY` and its
// snapshots do not know the clause exists, so the generated DDL is rewritten here.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PartitionedTable, type PartitionedTableEntry } from "./src/import.js";

const MIGRATIONS = join(import.meta.dirname, "migrations");

// What a rewrite refuses to guess. Drizzle emits the composite form only when the schema
// declares `primaryKey({ columns })`, so a missing key is a schema change, not a patch.
export class PartitionKeyMissing extends Error {
  public constructor(table: string, column: string) {
    super(
      `${table}: PRIMARY KEY does not carry "${column}" — declare the composite primary ` +
        "key in the schema; the generator does not synthesize keys.",
    );
  }
}

// A table this generator will not touch. Converting one that already exists unpartitioned
// is the copy-and-swap in reference/partitions.md, and a hand-written migration.
export class TableAlreadyLive extends Error {
  public constructor(table: string) {
    super(
      `${table}: an earlier migration creates it unpartitioned — converting a live table ` +
        "is the copy-and-swap in reference/partitions.md, written by hand.",
    );
  }
}

// The clause an entry asks for: the tenant level when it has one, the month level when it
// is the only one. A migration declares the outermost key and nothing below it.
const clauseFor = (entry: PartitionedTableEntry): { kind: string; column: string } | null => {
  if (entry.tenantKey) return { kind: "LIST", column: entry.tenantKey };
  return entry.column ? { kind: "RANGE", column: entry.column } : null;
};

// Every `CREATE TABLE "<t>" (…\n);` in one file, with the body the key check reads. The
// body is tempered against `CREATE TABLE` so a match cannot run past its own statement.
const STATEMENT =
  /CREATE TABLE (?:IF NOT EXISTS )?"([a-z_]+)" \(((?:(?!CREATE TABLE)[\s\S])*?)\n\)([^;]*);/g;

// Returns the file unchanged when there is nothing to do, so a run over a migration that
// creates no partitioned table rewrites nothing and reports nothing.
export const rewrite = (
  sql: string,
  live: ReadonlySet<string> = new Set(),
): { readonly sql: string; readonly partitioned: readonly string[] } => {
  const partitioned: string[] = [];

  const out = sql.replace(STATEMENT, (statement, table: string, body: string, tail: string) => {
    const entry = PartitionedTable.ALL.find((candidate) => candidate.name === table);
    const clause = entry ? clauseFor(entry) : null;
    if (!entry || !clause) return statement;

    // Idempotent: a statement somebody already wrote the clause onto is left alone, which
    // is what lets this run twice over the same generated file.
    if (/PARTITION BY/i.test(tail)) return statement;

    if (live.has(table)) throw new TableAlreadyLive(table);

    // Both keys when the table has two levels: Postgres requires every partition key in
    // every unique constraint, and the primary key is the one drizzle writes.
    const key = body.match(/PRIMARY KEY\s*\(([^)]*)\)/i)?.[1] ?? "";
    for (const required of [entry.tenantKey, entry.column].filter(Boolean)) {
      if (!key.includes(`"${required}"`)) throw new PartitionKeyMissing(table, required as string);
    }

    partitioned.push(table);
    return `CREATE TABLE "${table}" (${body}\n) PARTITION BY ${clause.kind} ("${clause.column}");`;
  });

  return { sql: out, partitioned };
};

// Every table an *earlier* migration creates without a `PARTITION BY`. Those are live,
// and a generator that rewrote one would be describing a table that is already there.
export const liveTables = (
  files: readonly { name: string; sql: string }[],
): ReadonlySet<string> => {
  const live = new Set<string>();

  for (const file of files) {
    for (const match of file.sql.matchAll(STATEMENT)) {
      const [, table = "", , tail = ""] = match;
      if (!/PARTITION BY/i.test(tail)) live.add(table);
    }
  }

  return live;
};

// The migration the last journal entry names — the one `drizzle-kit generate` just wrote,
// never an applied one, because the migrator hashes each file's whole text.
const latest = (): string | null => {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
    entries?: { tag: string }[];
  };

  return journal.entries?.at(-1)?.tag ?? null;
};

const main = (): void => {
  const tag = latest();
  if (!tag) return;

  const earlier = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql") && name !== `${tag}.sql`)
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));

  const file = join(MIGRATIONS, `${tag}.sql`);
  const { sql, partitioned } = rewrite(readFileSync(file, "utf8"), liveTables(earlier));
  if (partitioned.length === 0) return;

  writeFileSync(file, sql);
  console.log(`${tag}.sql: partitioned ${partitioned.join(", ")}`);
};

// Guarded so a spec can import the rewriter without running it. Every other script above
// `src/` runs on import, and none of them has a spec.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
