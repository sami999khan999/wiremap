import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2024",
  // The one package that imports binaries. `file` copies each one into `dist/` under a
  // content-hashed name and hands the import a URL — which is what makes `ImageAsset.src`
  // cacheable forever and self-invalidating.
  loader: {
    ".svg": "file",
    ".webp": "file",
    ".png": "file",
    ".woff2": "file",
  },
});
