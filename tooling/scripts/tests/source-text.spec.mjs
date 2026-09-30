// The parsers, given the inputs that used to walk past them.
//
// Every case here is one an earlier version of an assertion got wrong: a `//` inside a
// string, an indented top-level await, a column name that merely ends with the one being
// looked for, and an index callback whose brackets nest.

// @ts-check

import { describe, expect, it } from "vitest";

import {
  closingBracket,
  columnsOf,
  indexesOf,
  lineOf,
  outsideFences,
  specifiers,
  topLevelAwait,
  withoutComments,
} from "../source-text.mjs";

describe("specifiers", () => {
  it("finds every import form", () => {
    const source = [
      'import { a } from "alpha";',
      'export { b } from "beta";',
      'const c = await import("gamma");',
      'import "delta";',
      'const e = require("epsilon");',
    ].join("\n");

    expect(specifiers(source)).toEqual(["alpha", "beta", "gamma", "delta", "epsilon"]);
  });

  it("counts one inside a comment, which is the bias a boundary grep wants", () => {
    expect(specifiers('// import { a } from "drizzle-orm";')).toEqual(["drizzle-orm"]);
  });
});

describe("withoutComments", () => {
  it("blanks a line comment and keeps the line count", () => {
    const out = withoutComments("const a = 1; // note\nconst b = 2;\n");

    expect(out).not.toContain("note");
    expect(out.split("\n")).toHaveLength(3);
  });

  it("blanks a block comment without collapsing its newlines", () => {
    const out = withoutComments("/* one\ntwo */\nconst a = 1;\n");

    expect(out).not.toContain("one");
    expect(out.split("\n")).toHaveLength(4);
    expect(out.split("\n")[2]).toBe("const a = 1;");
  });

  it("does not treat a `//` inside a string as a comment", () => {
    expect(withoutComments('const url = "http://x"; const a = 1;')).toContain("const a = 1;");
  });

  it("keeps an escaped quote inside a string", () => {
    expect(withoutComments('const s = "a\\"b"; const a = 1;')).toContain("const a = 1;");
  });
});

describe("topLevelAwait", () => {
  it("finds one at column zero", () => {
    expect(topLevelAwait("await init();\n")).toBe(1);
  });

  it("finds an indented one, which a column-zero anchor walked past", () => {
    expect(topLevelAwait("const x = 1;\n  await init();\n")).toBe(2);
  });

  it("ignores one inside a function", () => {
    expect(topLevelAwait("async function f() {\n  await init();\n}\n")).toBeNull();
  });

  it("ignores one inside a comment or a string", () => {
    expect(topLevelAwait("// await init();\n")).toBeNull();
    expect(topLevelAwait('const s = "await init()";\n')).toBeNull();
    expect(topLevelAwait("const s = 'await init()';\n")).toBeNull();
    expect(topLevelAwait("const s = `await init()`;\n")).toBeNull();
  });

  it("misses one inside a template substitution, which depth counting never saw either", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the input.
    expect(topLevelAwait("const s = `${await f()}`;\n")).toBeNull();
  });

  it("keeps counting lines across a multi-line string", () => {
    expect(topLevelAwait("const s = `a\nb`;\nawait init();\n")).toBe(3);
  });

  it("does not match a word that merely contains it", () => {
    expect(topLevelAwait("const awaited = 1;\nconst reawait = 2;\n")).toBeNull();
  });
});

describe("lineOf", () => {
  it("is one-based, and falls back to line one when the needle is absent", () => {
    expect(lineOf("a\nb\nc", "c")).toBe(3);
    expect(lineOf("a\nb\nc", "z")).toBe(1);
  });
});

describe("closingBracket", () => {
  it("matches through nesting", () => {
    const source = "f(a, g(b), c)";
    expect(closingBracket(source, 1)).toBe(source.length - 1);
  });

  it("matches a brace as well as a paren", () => {
    const source = "{ a: { b: 1 } }";
    expect(closingBracket(source, 0)).toBe(source.length - 1);
  });

  it("ignores a bracket inside a comment or a string", () => {
    expect(closingBracket('( "a)b" )', 0)).toBe(8);
    expect(closingBracket("(\n  // )\n)", 0)).toBe(9);
  });
});

const BLOCK = {
  columns:
    "{\n" +
    '  id: uuid("id").primaryKey(),\n' +
    '  organizationId: uuid("organization_id").notNull(),\n' +
    '  lastActive: uuid("last_active_organization_id"),\n' +
    '  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),\n' +
    "}",
  extras:
    ", (t) => [\n" +
    '  uniqueIndex("tasks_key_uq").on(t.organizationId, t.key),\n' +
    '  index("tasks_owner_idx").on(t.ownerId),\n' +
    '  index("tasks_vec_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),\n' +
    "]",
};

describe("columnsOf", () => {
  it("reads the property name, the SQL name, and whether it is a foreign key", () => {
    expect(columnsOf(BLOCK)).toEqual([
      { property: "id", column: "id", isForeignKey: false },
      { property: "organizationId", column: "organization_id", isForeignKey: false },
      { property: "lastActive", column: "last_active_organization_id", isForeignKey: false },
      { property: "ownerId", column: "owner_id", isForeignKey: true },
    ]);
  });

  it("separates a column that merely ends with the tenant name", () => {
    const names = columnsOf(BLOCK).map((column) => column.column);

    expect(names).toContain("organization_id");
    expect(names.filter((name) => name === "organization_id")).toHaveLength(1);
  });
});

describe("indexesOf", () => {
  it("reads the name, uniqueness, and the leading column", () => {
    expect(indexesOf(BLOCK)).toEqual([
      { name: "tasks_key_uq", unique: true, columns: ["organizationId", "key"] },
      { name: "tasks_owner_idx", unique: false, columns: ["ownerId"] },
    ]);
  });

  it("omits a `.using()` index, which leads with no column for §17 or §18 to read", () => {
    expect(indexesOf(BLOCK).map((index) => index.name)).not.toContain("tasks_vec_idx");
  });

  it("does not let a nested callback swallow the next index", () => {
    const block = {
      columns: "{}",
      extras:
        ", (t) => [\n" +
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the input.
        '  index("a_idx").on(t.a, sql`lower(${t.b})`),\n' +
        '  index("b_idx").on(t.b),\n' +
        "]",
    };

    expect(indexesOf(block).map((index) => index.name)).toEqual(["a_idx", "b_idx"]);
  });
});

describe("outsideFences", () => {
  it("blanks a fenced block and keeps the line count", () => {
    const lines = outsideFences("before\n```\n`a/b.ts`\n```\nafter");

    expect(lines).toHaveLength(5);
    expect(lines.join("")).not.toContain("a/b.ts");
    expect(lines[0]).toBe("before");
    expect(lines[4]).toBe("after");
  });

  it("blanks a collapsed details block", () => {
    const lines = outsideFences("<details>\n`gone/x.ts`\n</details>\nkept");

    expect(lines.join("")).not.toContain("gone/x.ts");
    expect(lines[3]).toBe("kept");
  });

  it("blanks a line marked as unbuilt, and the section under a marked heading", () => {
    expect(outsideFences("`a/b.ts` — does not exist").join("")).toBe("");
    expect(outsideFences("## What this removed\n`a/b.ts`").join("")).toBe("");
  });
});
