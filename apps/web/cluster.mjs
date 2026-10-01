// One web process per core: rendering is single-threaded, so one process leaves every
// other core idle. Not Nitro's `node_cluster` preset, which forwards no signal and
// restarts no worker: a deploy's SIGTERM would kill the primary and orphan the rest.
import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./.output/server/index.mjs", import.meta.url));
const size = Number.parseInt(process.env.WEB_PROCESSES ?? "", 10) || availableParallelism();

// A worker that dies is replaced, but one that dies on boot every time would fork forever:
// past this many deaths in a minute the primary gives up and exits non-zero.
const MAX_DEATHS_PER_MINUTE = size * 3;
const deaths = [];
let stopping = false;

cluster.setupPrimary({ exec: entry });
for (let index = 0; index < size; index += 1) cluster.fork();

cluster.on("exit", (worker, code, signal) => {
  if (stopping) {
    if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
    return;
  }

  const now = Date.now();
  deaths.push(now);
  while (deaths.length > 0 && (deaths[0] ?? now) < now - 60_000) deaths.shift();
  process.stderr.write(
    `${JSON.stringify({ event: "web.worker.exited", pid: worker.process.pid, code, signal })}\n`,
  );
  if (deaths.length > MAX_DEATHS_PER_MINUTE) process.exit(1);
  cluster.fork();
});

// The drain window each worker gets (srvx reads the same variable, in seconds) before the
// primary closes its IPC channel: an open channel alone keeps a worker's event loop alive.
const DRAIN_MS = (Number.parseInt(process.env.SERVER_SHUTDOWN_TIMEOUT ?? "", 10) || 5) * 1000;
const workers = () => Object.values(cluster.workers ?? {}).filter((worker) => worker !== undefined);

// Each worker drains on its own SIGTERM (src/server/container.ts); the primary waits for
// all of them, so an orchestrator sees one process stop when the last request has finished.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    for (const worker of workers()) worker.process.kill(signal);
    setTimeout(() => {
      for (const worker of workers()) worker.disconnect();
    }, DRAIN_MS + 2_000).unref();
    setTimeout(() => {
      for (const worker of workers()) worker.process.kill("SIGKILL");
      process.exit(1);
    }, DRAIN_MS + 15_000).unref();
  });
}
