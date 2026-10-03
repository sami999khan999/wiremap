// Everything the CLI takes from outside itself, in one place.

// ── node ─────────────────────────────────────────────────────────────────────
export { existsSync } from "node:fs";
export { writeFile } from "node:fs/promises";
export { default as nodePath } from "node:path";
export { fileURLToPath } from "node:url";
export { gzipSync } from "node:zlib";

// ── @loadbearing/analyzer ────────────────────────────────────────────────────
export { Analyzer } from "@loadbearing/analyzer";

// ── @loadbearing/contracts ───────────────────────────────────────────────────
export type { GraphDocument } from "@loadbearing/contracts";
