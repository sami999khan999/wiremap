import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.mjs"],
    // Every fixture case spawns `check-architecture.mjs` over a temp tree. The 5s default
    // is a pass on an idle machine and a flake in a 16-way `pnpm test`.
    testTimeout: 60_000,
  },
});
