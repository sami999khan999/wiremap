import { WorkerBootstrap } from "./bootstrap/index.js";
import { Env } from "./env.js";
import { Container, RedisConnection } from "./import.js";

const config = Env.containerConfig();
const container = new Container(config);

// Its own connection, which keeps `Container.redis` private. It must be a
// `RedisConnection` — see docs/reference/shutdown.md.
const redis = new RedisConnection({
  cacheUrl: config.redis.cacheUrl,
  queueUrl: config.redis.queueUrl,
});

const bootstrap = new WorkerBootstrap(container, redis);

// Before `start()`, so a throw during boot lands in the same log stream as one during
// work. Node's default handler prints a stack no collector can key on.
process.on("unhandledRejection", (reason: unknown) => {
  container.logger.failure(reason, { service: "worker", phase: "unhandledRejection" });
  process.exit(1);
});

process.on("uncaughtException", (error: unknown) => {
  container.logger.failure(error, { service: "worker", phase: "uncaughtException" });
  process.exit(1);
});

// How long a signal waits for boot to finish before giving up on a drain. `start()`
// blocks on an unreachable queue Redis, and an unbounded wait is a SIGKILL.
const BOOT_GRACE_MS = 5_000;

// Started but not yet awaited, so the handlers below exist while boot is still running.
// A signal arriving in that window drains instead of killing a half-built worker.
const started = bootstrap.start();

// Which side of the race won. `Promise.race` reports neither, and "boot finished" is
// the whole question: there is nothing to drain until the consumers are registered.
let booted = false;
void started.then(
  () => {
    booted = true;
  },
  () => undefined,
);

const shutdown = async (signal: "SIGTERM" | "SIGINT"): Promise<never> => {
  try {
    await Promise.race([
      started.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, BOOT_GRACE_MS).unref()),
    ]);

    // Hung boot. Exiting non-zero is the honest answer: nothing was registered, so
    // `close()` on a worker that never started is not the same as a drain.
    if (!booted) {
      container.logger.failure(new Error("boot did not finish before the signal deadline"), {
        service: "worker",
        signal,
        graceMs: BOOT_GRACE_MS,
      });
      return process.exit(1);
    }

    await bootstrap.stop(signal);
    return process.exit(0);
  } catch (error: unknown) {
    // Logged, never swallowed: a bare `.catch(() => process.exit(1))` turns every
    // shutdown failure into an exit code.
    container.logger.failure(error, { service: "worker", signal });
    return process.exit(1);
  }
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

// Top-level await works because the package is ESM under NodeNext resolution.
try {
  await started;
} catch (error: unknown) {
  container.logger.failure(error, { service: "worker", phase: "start" });
  process.exit(1);
}
