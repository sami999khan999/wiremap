import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Shard, TablePlacement } from "../../src/primitive/shard.js";

// Resolved from this file rather than `process.cwd()`, so the assertion holds whether
// vitest is run from the package or from the workspace root.
const SCHEMA_DIR = fileURLToPath(
  new URL("../../../infrastructure/src/pg/schema/", import.meta.url),
);

// Every `pgTable("name"` in the schema folder. The placement lists have to cover them
// all, which is the claim decision D14 makes and nothing checked until now.
const tablesInSchema = (): readonly string[] => {
  const names: string[] = [];

  for (const file of readdirSync(SCHEMA_DIR).filter((one) => one.endsWith(".schema.ts"))) {
    const source = readFileSync(`${SCHEMA_DIR}${file}`, "utf8");
    for (const match of source.matchAll(/pgTable\(\s*"([a-z_]+)"/g)) {
      const name = match[1];
      if (name) names.push(name);
    }
  }

  return names;
};

describe("Shard.keyOf", () => {
  it("brands a non-empty key", () => {
    expect(Shard.keyOf("018f8c00-0000-7000-8000-000000000010")).toBe(
      "018f8c00-0000-7000-8000-000000000010",
    );
  });

  // An empty key resolves to whichever node the directory answers with, which would
  // place a tenant's rows silently rather than loudly.
  it("refuses an empty key", () => {
    expect(() => Shard.keyOf("")).toThrow();
    expect(() => Shard.keyOf("   ")).toThrow();
  });

  it("trims, so a key from a header is the key from a row", () => {
    expect(Shard.keyOf("  abc  ")).toBe("abc");
  });
});

describe("TablePlacement.of", () => {
  it("places the catalog tables", () => {
    expect(TablePlacement.of("users")).toBe("catalog");
    expect(TablePlacement.of("organizations")).toBe("catalog");
    expect(TablePlacement.of("partition_archive")).toBe("catalog");
  });

  it("places the two local tables", () => {
    expect(TablePlacement.of("activity_log")).toBe("local");
    expect(TablePlacement.of("outbox_event")).toBe("local");
  });

  // `routed` is the default rather than a third list: a new slice's table needs no
  // edit here, and an unplaced table trips rather than reading the wrong node.
  it("routes everything else, including a table nobody has written yet", () => {
    expect(TablePlacement.of("messages")).toBe("routed");
    expect(TablePlacement.of("document_chunks")).toBe("routed");
    expect(TablePlacement.of("tasks")).toBe("routed");
  });

  // Decision D14's claim, checked: the three lists cover every table in the schema
  // folder exactly once, with nothing left over.
  it("covers every table in the schema folder", () => {
    const tables = tablesInSchema();

    expect(tables.length).toBeGreaterThan(20);
    for (const table of tables) {
      expect(["catalog", "local", "routed"]).toContain(TablePlacement.of(table));
    }
  });

  // The other half of that claim: a name on the catalog list that no schema file
  // declares is a placement for a table that does not exist.
  it("names no catalog table the schema does not declare", () => {
    const tables = new Set(tablesInSchema());

    for (const name of TablePlacement.CATALOG) {
      // `shard_assignments` arrives with `22.3`; every other name is on disk already.
      if (name === "shard_assignments") continue;
      expect(tables, name).toContain(name);
    }
  });
});
