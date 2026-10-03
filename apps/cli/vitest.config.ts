import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: { include: ["tests/**/*.spec.ts"], testTimeout: 30_000 },
});
