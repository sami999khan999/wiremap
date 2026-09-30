import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { CATALOG_TABLES } from "../../src/pg/repository/pg-partition-archive.gateway.js";
import { openDatabase } from "../support/database.js";

let database: Database;

beforeAll(() => {
  database = openDatabase();
});

afterAll(async () => {
  await database.close();
});

// Every unique index on the table, as a set of column names. A keyset that does not
// contain one of these pages over a column that repeats, and skips rows at the boundary.
async function uniqueColumnSets(table: string): Promise<readonly (readonly string[])[]> {
  const result = await database.client.execute<{ cols: string[] }>(
    sql`select array_agg(a.attname::text order by a.attname::text) as cols
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indisunique and i.indrelid = ${table}::regclass
        group by i.indexrelid`,
  );

  return result.rows.map((row) => row.cols);
}

// `R.40`. `role_permissions` was keyed on `permission` alone, which is unique per role
// and not per tenant — so a page ending mid-permission dropped every later role's copy.
describe("the tenant export's keyset columns", () => {
  it.each(CATALOG_TABLES.map((table) => [table.name, table.keys] as const))(
    "%s pages on columns that are unique within the tenant",
    async (name, keys) => {
      // The tenant is implied: every query here is already filtered on it, so the keyset
      // only has to be unique *within* one organization.
      const declared = new Set(["organization_id", ...keys]);
      const sets = await uniqueColumnSets(name);

      expect(sets.length).toBeGreaterThan(0);
      expect(
        sets.some((columns) => columns.every((column) => declared.has(column))),
        `${name} pages on (${keys.join(", ")}), which no unique index is covered by`,
      ).toBe(true);
    },
  );

  // The one the review found, named rather than left to the loop: it is the case that
  // makes the loop worth having, and a regression here reads as a one-line diff.
  it("pages role_permissions on both halves of its key", () => {
    const table = CATALOG_TABLES.find((entry) => entry.name === "role_permissions");

    expect(table?.keys).toEqual(["role_id", "permission"]);
  });
});
