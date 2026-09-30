import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: {
    include: ["tests/**/*.spec.tsx", "tests/**/*.spec.ts"],
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // A render plus `userEvent` plus an assertion is seconds of jsdom on a loaded
    // machine, and the 5s default failed a different case every run under `pnpm test`.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
