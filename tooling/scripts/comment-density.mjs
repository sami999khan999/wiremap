// Comment density over the source tree, measured the way docs/opinions/comments.md
// judges it: what share of the lines is comment, and how many blocks exceed the
// two-line ceiling. Reports; never fails. The gate is check-architecture §14.
//
// Run: pnpm check:comments

// @ts-check

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".output", ".git", "migrations", "src-tauri"]);

// A separator carries no prose, and a pragma is machine-readable instruction the
// rule has no opinion about. Neither is a comment a reader has to hold.
const EXEMPT_LINE =
  /^\/\/\s*(──|biome-ignore|eslint-disable|eslint-enable|@ts-|#region|#endregion)/;

const TOP_FILES = 25;

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

function rel(file) {
  return relative(ROOT, file).replaceAll("\\", "/");
}

// Every directory that holds first-party source: packages/* and apps/*.
function sourceRoots() {
  const out = [];

  for (const group of ["packages", "apps"]) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;

    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!existsSync(join(dir, "package.json"))) continue;
      out.push({ name: `${group}/${name}`, dir });
    }
  }

  return out;
}

// A string containing `//` is not a comment, and neither is a `//` after code on
// the same line — only a line whose first non-space characters are `//`.
function measure(source) {
  const lines = source.split("\n");
  let comment = 0;
  let blank = 0;
  let blocks = 0;
  let run = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      blank += 1;
      // A blank line inside a `//` run ends the block: the reader gets a breath.
      if (run > 2) blocks += 1;
      run = 0;
      continue;
    }

    if (trimmed.startsWith("//")) {
      comment += 1;
      if (EXEMPT_LINE.test(trimmed)) {
        if (run > 2) blocks += 1;
        run = 0;
      } else {
        run += 1;
      }
      continue;
    }

    if (run > 2) blocks += 1;
    run = 0;
  }

  if (run > 2) blocks += 1;

  return { total: lines.length, comment, blank, blocks, code: lines.length - comment - blank };
}

function percent(comment, total) {
  return total === 0 ? 0 : (comment / total) * 100;
}

function pad(value, width) {
  return String(value).padStart(width);
}

const packages = [];
const files = [];

for (const { name, dir } of sourceRoots()) {
  // Generated files are written by nobody, and check-architecture §14 skips them too.
  const found = walk(join(dir, "src"), [".ts", ".tsx"]).filter(
    (file) => !/\.gen\.tsx?$/.test(file),
  );
  if (found.length === 0) continue;

  const totals = { files: found.length, total: 0, comment: 0, blocks: 0 };

  for (const file of found) {
    const stats = measure(readFileSync(file, "utf8"));
    totals.total += stats.total;
    totals.comment += stats.comment;
    totals.blocks += stats.blocks;
    files.push({ path: rel(file), ...stats });
  }

  packages.push({ name, ...totals });
}

packages.sort((a, b) => percent(b.comment, b.total) - percent(a.comment, a.total));
files.sort((a, b) => b.comment - a.comment);

const overall = packages.reduce(
  (sum, entry) => ({
    files: sum.files + entry.files,
    total: sum.total + entry.total,
    comment: sum.comment + entry.comment,
    blocks: sum.blocks + entry.blocks,
  }),
  { files: 0, total: 0, comment: 0, blocks: 0 },
);

console.log("package                        files    lines  comment       %  blocks");
console.log("─".repeat(72));

for (const entry of packages) {
  const share = percent(entry.comment, entry.total);
  console.log(
    `${entry.name.padEnd(28)} ${pad(entry.files, 6)} ${pad(entry.total, 8)} ${pad(entry.comment, 8)} ${pad(share.toFixed(1), 7)} ${pad(entry.blocks, 7)}`,
  );
}

console.log("─".repeat(72));
console.log(
  `${"overall".padEnd(28)} ${pad(overall.files, 6)} ${pad(overall.total, 8)} ${pad(overall.comment, 8)} ${pad(percent(overall.comment, overall.total).toFixed(1), 7)} ${pad(overall.blocks, 7)}`,
);

console.log(`\ntop ${TOP_FILES} files by comment lines`);
console.log("─".repeat(72));

for (const file of files.slice(0, TOP_FILES)) {
  const share = percent(file.comment, file.total);
  console.log(
    `${pad(file.comment, 5)} ${pad(`${share.toFixed(0)}%`, 5)} ${pad(file.blocks, 4)} blocks  ${file.path}`,
  );
}

const worst = packages[0];
const worstLine = worst
  ? `Worst package: ${basename(worst.name)} at ${percent(worst.comment, worst.total).toFixed(1)} %.`
  : "No packages measured.";
console.log(`\n${overall.blocks} blocks over two lines. ${worstLine}`);
