import { defineConfig } from "tsup";

// CommonJS, because that is what every VS Code since the oldest in `engines` loads. The
// workspace packages are inlined; `vscode` is the host's own module and is never bundled.
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["cjs"],
  target: "node20",
  platform: "node",
  bundle: true,
  clean: true,
  noExternal: [/^@loadbearing\//],
  external: ["vscode"],
});
