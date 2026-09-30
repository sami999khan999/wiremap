import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The repository root, not this package: a pnpm filter runs with the package as cwd. A
// vitest config is a bin's argument rather than a `tsx` entrypoint, so it loads its own.
const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run the web smoke suite.`);
  return value;
};

const optional = (name: string): string | undefined => process.env[name] || undefined;

// `28025` is the template's own default, and this is the only place the suite needs it:
// Mailpit has no URL in either `env.ts`, because no application code ever reads it.
const MAILPIT_DEFAULT = "http://localhost:28025";

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: {
    include: ["tests/smoke/**/*.smoke.spec.ts"],
    // Serially: every file here signs somebody up, and two of them racing on the same
    // Mailpit inbox is a flake that only reproduces on a fast machine.
    fileParallelism: false,
    // Boots the built server and the worker, and sweeps what the run created. The
    // accounts live in the same database `pnpm test` uses — see `tests/smoke/support/`.
    globalSetup: ["tests/smoke/support/server.ts"],
    // A real sign-up is a mail job, a worker poll and an SMTP round trip.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    provide: {
      smoke: {
        databaseUrl: required("DATABASE_URL"),
        mailpitUrl: optional("MAILPIT_URL") ?? MAILPIT_DEFAULT,
      },
    },
  },
});
