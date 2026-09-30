import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace siblings to their `src/`, not a stale `dist/`.
  resolve: { conditions: ["development"] },
  test: { include: ["tests/**/*.spec.ts"] },
});
