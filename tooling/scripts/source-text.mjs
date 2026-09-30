// The text parsers the assertions in `check-architecture.mjs` are built out of.
//
// They live here rather than in that file because they are the half of it that can be
// checked without a repository to point at: every one is a pure function of a string,
// so `tests/source-text.spec.mjs` can hand each the input that used to walk past it.

// @ts-check

// Import specifiers only — static, dynamic, and re-export. A specifier inside a
// comment or a string still counts, which is the correct bias for a boundary grep.
export function specifiers(source) {
  const found = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }

  return found;
}

// Comments blanked, newlines kept, so a line number still means what it says. Strings
// are walked rather than skipped over, or a `//` inside one would blank the rest of a line.
export function withoutComments(source) {
  let out = "";

  for (let i = 0; i < source.length; i += 1) {
    const rest = source.slice(i, i + 2);

    if (rest === "//") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }

    if (rest === "/*") {
      const end = source.indexOf("*/", i + 2);
      const skipped = source.slice(i, end === -1 ? source.length : end + 2);
      out += skipped.replaceAll(/[^\n]/g, " ");
      i += skipped.length - 1;
      continue;
    }

    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      out += char;
      i += 1;
      while (i < source.length && source[i] !== char) {
        out += source[i];
        i += source[i] === "\\" ? 2 : 1;
      }
      out += source[i] ?? "";
      continue;
    }

    out += char;
  }

  return out;
}

// The line of the first `await` outside every brace, bracket and paren, or null. Depth,
// not a column-0 anchor: `tsup` indents a wrapped module and minification has no columns.
export function topLevelAwait(source) {
  const clean = withoutComments(source);
  let depth = 0;
  let line = 1;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    // A string is data: `const s = "await me"` in a bundle is not a top-level await. A
    // template goes too -- `${await f()}` sits inside the `{`, so depth never saw it.
    if (char === '"' || char === "'" || char === "`") {
      i += 1;
      while (i < clean.length && clean[i] !== char) {
        if (clean[i] === "\n") line += 1;
        i += clean[i] === "\\" ? 2 : 1;
      }
      continue;
    }

    if (char === "\n") line += 1;
    else if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (
      depth === 0 &&
      char === "a" &&
      clean.startsWith("await", i) &&
      !/[\w$]/.test(clean[i - 1] ?? " ") &&
      !/[\w$]/.test(clean[i + 5] ?? " ")
    ) {
      return line;
    }
  }

  return null;
}

export function lineOf(source, needle) {
  const index = source.indexOf(needle);
  if (index === -1) return 1;
  return source.slice(0, index).split("\n").length;
}

// The end of the bracket that opens at `open`, which is the index of a `(` or a `{`.
// A regex cannot do this: an index callback nests brackets and the comments hold more.
export function closingBracket(source, open) {
  const close = source[open] === "{" ? "}" : ")";
  let depth = 0;

  for (let i = open; i < source.length; i += 1) {
    const char = source[i];

    if (char === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      if (newline === -1) return source.length - 1;
      i = newline;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      i += 1;
      while (i < source.length && source[i] !== char) i += source[i] === "\\" ? 2 : 1;
      continue;
    }

    if (char === source[open]) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return source.length - 1;
}

// `userId: uuid("user_id").notNull().references(...)` → the property name the index
// callback will use, the SQL name a migration will use, and whether it is a foreign key.
export function columnsOf(block) {
  const found = [...block.columns.matchAll(/(\w+):\s*\w+\(\s*["']([^"']+)["']/g)];

  return found.map((match, position) => {
    const next = found[position + 1];
    const declaration = block.columns.slice(match.index, next ? next.index : undefined);

    return {
      property: match[1],
      column: match[2],
      isForeignKey: declaration.includes(".references("),
    };
  });
}

// `foreignKey({ columns: [t.a, t.b], … })` → ["a", "b"], the leading property first. The
// composite form a reference to a partitioned table has to take, which `.references()`
// cannot express — so an assertion reading only that form stops seeing those columns.
export function foreignKeysOf(block) {
  const out = [];

  for (const match of block.extras.matchAll(/\bforeignKey\(\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const args = block.extras.slice(open + 1, closingBracket(block.extras, open));
    const columns = args.match(/columns:\s*\[([^\]]*)\]/)?.[1] ?? "";

    out.push([...columns.matchAll(/\bt\.(\w+)/g)].map((column) => column[1]));
  }

  return out;
}

// `index("x").on(t.a, t.b)` → { name, unique, columns: ["a", "b"] } in property names.
// `.using("hnsw", t.embedding.op(...))` leads with no column and is deliberately absent.
export function indexesOf(block) {
  const out = [];
  const pattern = /\b(index|uniqueIndex)\(\s*["']([^"']+)["']\s*\)\s*\.on\(/g;

  for (const match of block.extras.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const args = block.extras.slice(open + 1, closingBracket(block.extras, open));

    out.push({
      name: match[2],
      unique: match[1] === "uniqueIndex",
      columns: [...args.matchAll(/\bt\.(\w+)/g)].map((column) => column[1]),
    });
  }

  return out;
}

// A path the page already tells its reader is not on disk: a slice the setup docs teach
// by building but do not ship, or a file a step deleted. Marking one is the author's
// job — say so on the line that names it — and honouring the marker is this one's.
export const UNBUILT = /illustrative|not written yet|does not exist|removed|deleted|☐/i;

// Fenced blocks are code and diagrams: an ASCII tree is full of names that are not
// paths, and a snippet's imports resolve against the file it would live in, not here.
// A collapsed `<details>` block is a historical listing kept for comparison, which is
// the one place a page is deliberately describing a tree that is gone.
export function outsideFences(source) {
  const kept = [];
  let fenced = false;
  let collapsed = false;
  // A heading can carry the marker for the list under it — "What this removed" is a
  // section of paths that are gone, and repeating the word per bullet reads worse.
  let section = false;

  for (const line of source.split("\n")) {
    const trimmed = line.trimStart();

    if (trimmed.startsWith("```")) {
      fenced = !fenced;
      kept.push("");
      continue;
    }
    if (trimmed.startsWith("<details")) collapsed = true;
    if (trimmed.startsWith("#")) section = UNBUILT.test(line);

    kept.push(fenced || collapsed || section || UNBUILT.test(line) ? "" : line);

    if (trimmed.startsWith("</details>")) collapsed = false;
  }

  return kept;
}
