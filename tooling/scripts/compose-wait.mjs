// Waits for `infra/docker-compose.yml` to be ready, which `docker compose up -d` does not.
//
// Not `--wait`: the stack contains a one-shot. `minio-init` creates buckets and exits 0,
// and a flag that waits for every service to be *running* has no way to be told that one
// of them finishing is the success case.
//
// Run: node tooling/scripts/compose-wait.mjs

// @ts-check

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FILE = "infra/docker-compose.yml";
const PROFILES = [];
const TIMEOUT_MS = 180_000;
const INTERVAL_MS = 3_000;

// One JSON object per line on some versions, one JSON array on others. Both shapes have
// shipped in the 2.x series, so parsing either is cheaper than pinning a version.
function containers() {
  const out = execFileSync(
    "docker",
    ["compose", "-f", FILE, ...PROFILES, "ps", "--all", "--format", "json"],
    { encoding: "utf8" },
  ).trim();

  if (out.length === 0) return [];
  if (out.startsWith("[")) return JSON.parse(out);

  return out
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

// Services whose success is *finishing*, not running. Without this a one-shot counts as
// ready the moment it starts, which is the whole thing it exists to gate.
const ONE_SHOTS = new Set(["minio-init"]);

// A service is ready when it is healthy, when it is running without a healthcheck to be
// healthy by, or when it has already finished successfully.
export function readiness(container) {
  const state = container.State ?? "";
  const health = container.Health ?? "";

  if (health === "healthy") return { ready: true, why: "healthy" };
  if (health === "unhealthy") return { ready: false, why: "unhealthy", fatal: true };
  if (state === "exited") {
    const code = container.ExitCode ?? 0;
    return code === 0
      ? { ready: true, why: "exited 0" }
      : { ready: false, why: `exited ${code}`, fatal: true };
  }
  // Checked before the running-without-a-healthcheck rule below, which would otherwise
  // pass a one-shot that is still creating the buckets the next step reads.
  if (ONE_SHOTS.has(container.Service ?? "")) return { ready: false, why: state || "unknown" };
  if (state === "running" && health === "") return { ready: true, why: "running" };

  return { ready: false, why: health || state || "unknown" };
}

async function wait() {
  const deadline = Date.now() + TIMEOUT_MS;

  while (true) {
    const all = containers();
    const report = all.map((c) => ({ name: c.Service ?? c.Name, ...readiness(c) }));
    const waiting = report.filter((r) => !r.ready);

    if (all.length > 0 && waiting.length === 0) {
      console.log(`compose ready: ${report.map((r) => `${r.name}=${r.why}`).join(" ")}`);
      return 0;
    }

    const fatal = waiting.filter((r) => r.fatal);
    if (fatal.length > 0) {
      console.error(`compose failed: ${fatal.map((r) => `${r.name}=${r.why}`).join(" ")}`);
      return 1;
    }

    if (Date.now() > deadline) {
      console.error(`compose timed out: ${waiting.map((r) => `${r.name}=${r.why}`).join(" ")}`);
      return 1;
    }

    console.log(`waiting: ${waiting.map((r) => `${r.name}=${r.why}`).join(" ")}`);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

// Only when run, never on import: `readiness` is the half worth testing, and a module that
// shells out to docker the moment it is imported cannot be.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await wait());
}
