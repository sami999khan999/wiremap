// Everything the extension takes from outside itself, in one place.

// ── vscode ───────────────────────────────────────────────────────────────────
// The editor's own module, provided at run time and never bundled. Specs alias it to
// `tests/support/vscode.ts`.
import * as vscode from "vscode";

// ── node ─────────────────────────────────────────────────────────────────────
export { readFile } from "node:fs/promises";
export { default as nodePath } from "node:path";
export { gunzipSync } from "node:zlib";
// ── @loadbearing/contracts ───────────────────────────────────────────────────
export { GraphContract, type GraphDocument, type GraphRoute } from "@loadbearing/contracts";
// ── @loadbearing/graph ───────────────────────────────────────────────────────
export { GraphIndex, type Reached } from "@loadbearing/graph";
export { vscode };
