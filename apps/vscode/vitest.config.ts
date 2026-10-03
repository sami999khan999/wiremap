import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"],
    // The editor provides `vscode` at run time; under test there is no editor.
    alias: { vscode: fileURLToPath(new URL("./tests/support/vscode.ts", import.meta.url)) },
  },
  test: { include: ["tests/**/*.spec.ts"], testTimeout: 30_000 },
});
