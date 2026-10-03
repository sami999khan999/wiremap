// Everything this package takes from outside itself, in one place. Node-only: nothing here
// may reach a browser bundle, which is why the CLI is the analyzer's only host.

// ── node ─────────────────────────────────────────────────────────────────────
export { execFile } from "node:child_process";
export { readdir, readFile, stat } from "node:fs/promises";
export { createRequire } from "node:module";
export { default as nodePath } from "node:path";
export { promisify } from "node:util";
// ── @loadbearing/contracts ───────────────────────────────────────────────────
export {
  type FileRole,
  GRAPH_VERSION,
  type GraphCall,
  type GraphDocument,
  type GraphEdge,
  type GraphFile,
  type GraphFramework,
  type GraphLanguage,
  type GraphRoute,
  HTTP_METHODS,
  type HttpMethod,
} from "@loadbearing/contracts";
// ── @loadbearing/graph ───────────────────────────────────────────────────────
export { GraphIndex } from "@loadbearing/graph";
// ── typescript ───────────────────────────────────────────────────────────────
export { default as ts } from "typescript";
// ── web-tree-sitter ──────────────────────────────────────────────────────────
export { Language, type Node as SyntaxNode, Parser, type Tree } from "web-tree-sitter";
// ── yaml ─────────────────────────────────────────────────────────────────────
export { parse as parseYaml } from "yaml";
