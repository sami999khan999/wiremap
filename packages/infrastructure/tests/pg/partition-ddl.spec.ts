import { describe, expect, it } from "vitest";
import { liveTables, PartitionKeyMissing, rewrite, TableAlreadyLive } from "../../partition-ddl.js";

// Drizzle's own shape, down to the tab indent and the trailing `--> statement-breakpoint`:
// the rewriter matches generated text, so a fixture that tidied it would prove nothing.
const created = (table: string, columns: string, key: string) =>
  `CREATE TABLE "${table}" (\n${columns}\n\tCONSTRAINT "${table}_pk" PRIMARY KEY(${key})\n);\n`;

const ID = '\t"id" uuid NOT NULL,\n\t"organization_id" uuid NOT NULL,';
const TIMED = `${ID}\n\t"created_at" timestamp with time zone DEFAULT now() NOT NULL,`;

describe("the partition DDL generator", () => {
  // Both levels in the allowlist means the migration declares the outer one: the month
  // level under a tenant is the seed's, at migrate time and at signup.
  it("writes LIST on a table with a tenant level", () => {
    const { sql, partitioned } = rewrite(
      created("notifications", TIMED, '"id","organization_id","created_at"'),
    );

    expect(partitioned).toEqual(["notifications"]);
    expect(sql).toContain('\n) PARTITION BY LIST ("organization_id");');
    expect(sql).not.toContain("RANGE");
  });

  it("writes RANGE on the one table with no tenant level", () => {
    const columns = `\t"id" uuid NOT NULL,\n\t"occurred_at" timestamp with time zone NOT NULL,`;
    const { sql, partitioned } = rewrite(created("outbox_event", columns, '"id","occurred_at"'));

    expect(partitioned).toEqual(["outbox_event"]);
    expect(sql).toContain('\n) PARTITION BY RANGE ("occurred_at");');
  });

  it("leaves a table the allowlist does not name exactly as drizzle wrote it", () => {
    const input = created("tasks", ID, '"id"');
    const { sql, partitioned } = rewrite(input);

    expect(partitioned).toEqual([]);
    expect(sql).toBe(input);
  });

  // Idempotent, because `db:generate` is run again the moment somebody edits the schema
  // and the file it just wrote is the file it opens.
  it("skips a statement that already carries the clause", () => {
    const once = rewrite(
      created("notifications", TIMED, '"id","organization_id","created_at"'),
    ).sql;
    const twice = rewrite(once);

    expect(twice.partitioned).toEqual([]);
    expect(twice.sql).toBe(once);
  });

  // The generator does not synthesize keys. Drizzle emits the composite form only when
  // the schema declares `primaryKey({ columns })`, so this is a schema change.
  it("refuses a primary key that omits a partition key", () => {
    expect(() => rewrite(created("notifications", TIMED, '"id"'))).toThrow(PartitionKeyMissing);
    expect(() => rewrite(created("notifications", TIMED, '"id"'))).toThrow(
      "does not synthesize keys",
    );
  });

  it("refuses a two-level table whose key carries the tenant and not the month", () => {
    expect(() => rewrite(created("notifications", TIMED, '"id","organization_id"'))).toThrow(
      'does not carry "created_at"',
    );
  });

  // Converting a table that already exists is the copy-and-swap in partitions.md, and a
  // hand-written migration — `0023` is exactly that case.
  it("refuses a table an earlier migration created unpartitioned", () => {
    const earlier = [{ name: "0000_base.sql", sql: created("notifications", TIMED, '"id"') }];
    const live = liveTables(earlier);

    expect(live.has("notifications")).toBe(true);
    expect(() =>
      rewrite(created("notifications", TIMED, '"id","organization_id","created_at"'), live),
    ).toThrow(TableAlreadyLive);
  });

  // A table an earlier migration created *and already partitioned* is not live in the
  // sense that matters: this is the same migration being regenerated.
  it("does not count an already-partitioned earlier statement as live", () => {
    const partitioned = rewrite(
      created("notifications", TIMED, '"id","organization_id","created_at"'),
    ).sql;

    expect(liveTables([{ name: "0000_base.sql", sql: partitioned }]).has("notifications")).toBe(
      false,
    );
  });

  // The temper against `CREATE TABLE` in the statement pattern: without it a lazy match
  // binds the first table in the file to the last `);` in it.
  it("rewrites one statement of several without touching its neighbours", () => {
    const input =
      created("tasks", ID, '"id"') +
      "--> statement-breakpoint\n" +
      created("doc_spaces", ID, '"id","organization_id"') +
      "--> statement-breakpoint\n" +
      created("goals", ID, '"id"');

    const { sql, partitioned } = rewrite(input);

    expect(partitioned).toEqual(["doc_spaces"]);
    expect(sql.match(/PARTITION BY/g)).toHaveLength(1);
    expect(sql).toContain(created("tasks", ID, '"id"'));
    expect(sql).toContain(created("goals", ID, '"id"'));
  });
});
