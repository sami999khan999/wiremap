import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace siblings to their `src/`, not a stale `dist/`.
  resolve: { conditions: ["development"] },
  test: {
    include: ["tests/**/*.spec.tsx", "tests/**/*.spec.ts"],
    // The first package in the repository that needs a DOM. Components are the thing
    // being tested here, and a component asserted through its props alone is a type
    // check, not a test.
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
