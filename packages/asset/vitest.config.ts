import { defineConfig } from "vitest/config";

export default defineConfig({
  // Without an explicit include, vitest's default glob walks `dist/` too.
  test: { include: ["tests/**/*.spec.ts"] },
});
