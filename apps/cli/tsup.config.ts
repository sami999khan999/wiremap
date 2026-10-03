import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);

// One ESM file with the workspace packages inlined; the three npm dependencies stay
// external. The PHP grammar is copied beside it, so the installed CLI needs no native build.
export default defineConfig({
  entry: { index: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  bundle: true,
  clean: true,
  noExternal: [/^@loadbearing\//],
  external: ["typescript", "web-tree-sitter", "yaml"],
  banner: { js: "#!/usr/bin/env node" },
  async onSuccess() {
    await mkdir("dist", { recursive: true });
    await copyFile(
      require.resolve("tree-sitter-php/tree-sitter-php.wasm"),
      "dist/tree-sitter-php.wasm",
    );
  },
});
