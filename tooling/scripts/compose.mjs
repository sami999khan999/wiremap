#!/usr/bin/env node

// The one place `docker compose` is invoked, so the stack and the apps read the same
// `.env`. Compose's own default is the file beside the compose file — `infra/.env`.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMPOSE_FILE = join(ROOT, "infra", "docker-compose.yml");
const ENV_FILE = join(ROOT, ".env");

// `--env-file` and not `--env-file-if-exists`: compose has no such flag and errors on a
// missing file, and CI runs `infra:up` with no `.env` at all. Hence the existence check.
export function composeArgs(args, hasEnvFile) {
  return ["compose", ...(hasEnvFile ? ["--env-file", ENV_FILE] : []), "-f", COMPOSE_FILE, ...args];
}

// Guarded so a spec can import `composeArgs` without starting a container.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const child = spawn("docker", composeArgs(process.argv.slice(2), existsSync(ENV_FILE)), {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("error", (error) => {
    console.error(`docker compose could not start: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}
