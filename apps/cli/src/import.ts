// Everything the CLI takes from outside itself, in one place.

// ── node ─────────────────────────────────────────────────────────────────────
export { execFile } from "node:child_process";
export { existsSync } from "node:fs";
export { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
export { tmpdir } from "node:os";
export { default as nodePath } from "node:path";
export { createInterface } from "node:readline";
export { fileURLToPath } from "node:url";
export { promisify } from "node:util";
export { gunzipSync, gzipSync } from "node:zlib";

// ── @loadbearing/analyzer ────────────────────────────────────────────────────
export { Analyzer } from "@loadbearing/analyzer";

// ── @loadbearing/contracts ───────────────────────────────────────────────────
export type { GraphDocument } from "@loadbearing/contracts";
