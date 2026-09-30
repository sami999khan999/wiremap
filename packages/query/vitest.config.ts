import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace siblings to their `src/`. Without it a spec runs against a
  // sibling's stale `dist/` and a green suite proves nothing about the code just edited.
  resolve: { conditions: ["development"] },
  test: {
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
    // `useAppMutation` is a hook, so one spec here renders. The rest need no DOM and
    // pay only the environment's start-up.
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
