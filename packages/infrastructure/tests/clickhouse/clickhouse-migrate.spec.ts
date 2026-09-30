import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrationOf, statementsOf } from "../../clickhouse-migrate.js";

const FIRST = fileURLToPath(
  new URL("../../clickhouse-migrations/0000_activity_events.sql", import.meta.url),
);

describe("statementsOf", () => {
  it("splits on a top-level semicolon", () => {
    expect(statementsOf("SELECT 1; SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("returns the whole text when there is no semicolon at all", () => {
    expect(statementsOf("CREATE TABLE t (a UInt8) ENGINE = MergeTree ORDER BY a")).toHaveLength(1);
  });

  // The regression, and not a hypothetical one: `0000`'s own comments contain "… archives
  // the rest to S3; this is where …", and a naive split cut the `CREATE TABLE` in half.
  it("ignores a semicolon inside a line comment", () => {
    const sql = "-- keeps thirteen months; the rest goes to S3\nSELECT 1";

    expect(statementsOf(sql)).toEqual([sql]);
  });

  it("ignores a semicolon inside a block comment", () => {
    expect(statementsOf("/* one; two */ SELECT 1")).toEqual(["/* one; two */ SELECT 1"]);
  });

  it("ignores a semicolon inside a string literal", () => {
    expect(statementsOf("SELECT 'a;b'; SELECT 2")).toEqual(["SELECT 'a;b'", "SELECT 2"]);
  });

  // `\\'` is ClickHouse's escape. A scanner that treated it as the closing quote would
  // read the rest of the file as SQL and split on the next semicolon it found.
  it("keeps an escaped quote inside the literal", () => {
    expect(statementsOf("SELECT 'a\\';b'; SELECT 2")).toEqual(["SELECT 'a\\';b'", "SELECT 2"]);
  });

  // ClickHouse answers a body of only comments with a 400, so a trailing fragment after
  // the last semicolon must not be sent.
  it("drops a chunk that is only comments or whitespace", () => {
    expect(statementsOf("SELECT 1;\n-- trailing note\n")).toEqual(["SELECT 1"]);
    expect(statementsOf("SELECT 1;   \n\n")).toEqual(["SELECT 1"]);
  });

  // The file itself, because the point of the scanner is this file.
  it("reads the shipped migration as exactly one statement", () => {
    const statements = statementsOf(readFileSync(FIRST, "utf8"));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS activity_events");
    expect(statements[0]).toContain("INTERVAL 5 YEAR");
  });

  // Unqualified on purpose: the migrator sends `database=` on the query string, so a
  // hard-coded prefix would put the table in the wrong place on a renamed database.
  it("names no database in the shipped migration", () => {
    expect(readFileSync(FIRST, "utf8")).not.toContain("ratchet.activity_events");
  });
});

describe("migrationOf", () => {
  it("reads the version and the name off the filename", () => {
    const migration = migrationOf("0007_projection_policy.sql", "SELECT 1");

    expect(migration.version).toBe(7);
    expect(migration.name).toBe("projection_policy");
  });

  // Loud rather than skipped: a file nobody can order is a file that applies in whatever
  // order `readdir` happens to return, which is the one thing a migrator may not do.
  it("refuses a filename it cannot order", () => {
    expect(() => migrationOf("activity_events.sql", "SELECT 1")).toThrow("Not a migration");
    expect(() => migrationOf("7_thing.sql", "SELECT 1")).toThrow("Not a migration");
  });
});
