import { RealtimeBootstrap } from "./bootstrap/index.js";
import { Env } from "./env.js";
import { Container } from "./import.js";
import { StreamListener } from "./server/index.js";

const container = new Container(Env.containerConfig());
const listener = new StreamListener(container, Env.trustedOrigins);
const bootstrap = new RealtimeBootstrap(container, listener, Env.shutdownTimeoutMs);

// Before `start()`, so a throw during boot lands in the same log stream as one during
// work. Node's default handler prints a stack no collector can key on.
process.on("unhandledRejection", (reason: unknown) => {
  container.logger.failure(reason, { service: "realtime", phase: "unhandledRejection" });
  process.exit(1);
});

process.on("uncaughtException", (error: unknown) => {
  container.logger.failure(error, { service: "realtime", phase: "uncaughtException" });
  process.exit(1);
});

const shutdown = async (signal: "SIGTERM" | "SIGINT"): Promise<never> => {
  try {
    await bootstrap.stop(signal);
    return process.exit(0);
  } catch (error: unknown) {
    // Logged, never swallowed: a bare `.catch(() => process.exit(1))` turns every
    // shutdown failure into an exit code.
    container.logger.failure(error, { service: "realtime", signal });
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
  await bootstrap.start(Env.port);
} catch (error: unknown) {
  container.logger.failure(error, { service: "realtime", phase: "start" });
  process.exit(1);
}
