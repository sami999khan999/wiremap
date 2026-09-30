// Boots a built app, waits for the line that says it is up, then asks it to stop.
//
// The hole this closes: every check in CI runs against source. Nothing ever started a
// process, so a missing environment variable — `env.ts` parses at module load — was
// invisible until a deploy. See docs/setup/26.
//
// Run: node tooling/scripts/boot-smoke.mjs worker | web | realtime

// @ts-check

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, freePort } from "./boot-app.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// One entry per app that can be booted headlessly. `started` is the literal text in the
// process's own output that means the socket is open, not a shape this script imposes.
const APPS = {
  worker: {
    entry: "apps/worker/dist/main.js",
    build: "pnpm --filter @loadbearing/worker build",
    started: '"event":"process.started"',
    stopped: '"event":"process.stopped"',
  },
  web: {
    entry: "apps/web/.output/server/index.mjs",
    build: "pnpm --filter @loadbearing/web build",
    // Nitro's own line, and it means a module loaded — which is exactly what `T-032`
    // also meant while every page answered 500. The probe below is the real assertion.
    started: "Listening on:",
    // `/`, not `/api/health`. The health route renders no JSX and reports its
    // dependencies, so it answers 200 through the bug this exists to catch and 503
    // through a dependency nobody started. See docs/setup/26-hygiene-and-ci.md, step 26.4d.
    probe: "/",
  },
  realtime: {
    entry: "apps/realtime/dist/main.js",
    build: "pnpm --filter @loadbearing/realtime build",
    started: '"event":"process.started"',
    stopped: '"event":"process.stopped"',
    // Liveness only: it proves the listener answers, and a stream needs a signed-in user.
    probe: "/healthz",
    // Its own variable, not `PORT`, because the web app's Vite reads it to proxy to.
    portEnv: "REALTIME_PORT",
  },
};

const TIMEOUT_MS = 60_000;

const name = process.argv[2] ?? "";
const app = Object.hasOwn(APPS, name) ? APPS[name] : undefined;

if (!app) {
  console.error(`usage: boot-smoke.mjs <${Object.keys(APPS).join("|")}>`);
  process.exit(2);
}

const entry = join(ROOT, app.entry);

if (!existsSync(entry)) {
  console.error(`✗ ${name}: ${app.entry} does not exist — run \`${app.build}\` first`);
  process.exit(1);
}

const port = app.probe ? await freePort() : 0;

const fail = (why) => {
  console.error(`✗ ${name}: ${why}`);
  process.exit(1);
};

// The line, not the socket, even for the web app: unlike the smoke suite this script
// exists to assert that the app *says* it started. See `boot-app.mjs`.
const booted = await bootApp({
  entry,
  started: app.started,
  cwd: ROOT,
  env: app.probe ? { ...process.env, [app.portEnv ?? "PORT"]: String(port) } : process.env,
  timeoutMs: TIMEOUT_MS,
}).catch((error) => fail(error.message));

const { child } = booted;
console.log(`✓ ${name}: booted`);

// A request that completes, with a body, from the built bundle. `T-032` was a server
// that imported cleanly, listened, and answered 500 on every page.
async function serves() {
  const url = `http://127.0.0.1:${port}${app.probe}`;
  const response = await fetch(url);
  const body = await response.text();

  if (response.status !== 200) fail(`${app.probe} answered ${response.status}`);
  if (body.trim().length === 0) fail(`${app.probe} answered 200 with an empty body`);

  console.log(`✓ ${name}: ${app.probe} answered 200, ${body.length} bytes`);
}

if (app.probe) {
  await serves().catch((error) => fail(`${app.probe} could not be reached — ${error.message}`));
}

// Attached before the signal, never after: a process that exits between the two has
// nowhere to report it and the script would hang on an event that already fired.
child.on("exit", (code, signal) => {
  // Only an app with a drain has a clean exit to assert. The web server holds no queue,
  // and on Windows SIGTERM is a terminate rather than a signal a process can catch.
  if (!app.stopped) return console.log(`✓ ${name}: served, then stopped`);

  // A drain that ends on the signal rather than on its own is a drain that did not
  // finish — the whole reason to send SIGTERM rather than kill the process.
  if (code !== 0) return fail(`did not exit cleanly on SIGTERM (code ${code}, signal ${signal})`);
  if (!booted.output().includes(app.stopped)) return fail(`no \`${app.stopped}\` on shutdown`);

  console.log(`✓ ${name}: drained and exited cleanly`);
});

booted.stop();
