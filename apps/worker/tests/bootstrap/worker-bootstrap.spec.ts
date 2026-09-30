import type { Container } from "@loadbearing/composition";
import { TestContainer } from "@loadbearing/composition";
import type { RedisConnection } from "@loadbearing/infrastructure";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerBootstrap } from "../../src/bootstrap/worker-bootstrap.js";

// `WORKER_SHUTDOWN_TIMEOUT_MS` in vitest.config.ts. A spec that outran it by accident
// would assert the backstop where it meant to assert the drain.
const BACKSTOP_MS = 20;

interface Closeable {
  close(): Promise<void>;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// The list `start()` fills. Reaching into it is what lets this spec drain a bootstrap
// without a live Redis behind a real BullMQ worker for every consumer.
function workersOf(bootstrap: WorkerBootstrap): Closeable[] {
  return (bootstrap as unknown as { workers: Closeable[] }).workers;
}

function harness(redisClose: () => Promise<void> = () => Promise.resolve()) {
  // `TestContainer` rather than an object literal of the members `stop()` touches: a
  // port added to the container is a compile error there, and would be silence here.
  const logger = { emit: vi.fn(), failure: vi.fn() };
  const container = {
    ...TestContainer.build(),
    logger,
    dispose: vi.fn(async () => undefined),
  } as unknown as Container;

  const redis = { close: redisClose } as unknown as RedisConnection;

  return { bootstrap: new WorkerBootstrap(container, redis), logger };
}

const codes = (logger: { emit: ReturnType<typeof vi.fn> }): string[] =>
  logger.emit.mock.calls.map((call) => String(call[0]));

describe("WorkerBootstrap.stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the drain already in flight to a second signal", async () => {
    const redis = deferred();
    const { bootstrap } = harness(() => redis.promise);

    const first = bootstrap.stop("SIGTERM");
    const second = bootstrap.stop("SIGINT");

    // The defect this replaces returned `undefined` from the guarded branch, so
    // `main.ts` chained `.then(() => process.exit(0))` onto an already-resolved promise.
    expect(second).toBe(first);

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    void second.then(() => {
      settled = true;
    });

    // Past the backstop, so only the pending Redis close is holding the drain open.
    await wait(BACKSTOP_MS * 3);
    expect(settled).toBe(false);

    redis.resolve();
    await Promise.all([first, second]);
    expect(settled).toBe(true);
  });

  it("announces the drain once however many signals arrive", async () => {
    const { bootstrap, logger } = harness();

    await Promise.all([bootstrap.stop("SIGTERM"), bootstrap.stop("SIGINT")]);

    expect(codes(logger).filter((code) => code === "process.stopping")).toHaveLength(1);
    expect(codes(logger).filter((code) => code === "process.stopped")).toHaveLength(1);
  });

  it("closes every worker it started", async () => {
    const { bootstrap } = harness();
    const close = vi.fn(async () => undefined);
    workersOf(bootstrap).push({ close }, { close });

    await bootstrap.stop("SIGTERM");

    expect(close).toHaveBeenCalledTimes(2);
  });

  it("logs a close that fails after the backstop rather than letting it go unhandled", async () => {
    const { bootstrap, logger } = harness();
    workersOf(bootstrap).push({
      close: async () => {
        await wait(BACKSTOP_MS * 4);
        throw new Error("worker never drained");
      },
    });

    // The drain finishes on the backstop, and the rejection arrives long afterwards. An
    // unhandled one reaches `main.ts`'s `unhandledRejection` handler, which exits 1.
    await expect(bootstrap.stop("SIGTERM")).resolves.toBeUndefined();
    expect(codes(logger)).toContain("process.stopped");

    await wait(BACKSTOP_MS * 5);
    expect(logger.failure).toHaveBeenCalledTimes(1);
    expect(logger.failure.mock.calls[0]?.[1]).toMatchObject({ phase: "close" });
  });
});
