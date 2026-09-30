import { FixedClock } from "@loadbearing/core";
import { ForbiddenError, InternalError, ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { JsonLogger } from "../../src/logger/json.logger.js";
import { REDACTED } from "../../src/logger/redactor.js";

const AT = new Date("2026-01-01T00:00:00.000Z");

interface Line {
  readonly level: string;
  readonly time: string;
  readonly event: string;
  readonly [field: string]: unknown;
}

function capture(
  options: { level?: "debug" | "info" | "warn" | "error"; random?: () => number } = {},
) {
  const lines: Line[] = [];
  const logger = new JsonLogger({
    clock: new FixedClock(AT),
    sink: (line) => lines.push(JSON.parse(line) as Line),
    random: options.random ?? (() => 0),
    ...(options.level ? { level: options.level } : {}),
  });
  return { logger, lines };
}

describe("Logger.emit", () => {
  it("writes one line of valid JSON with the fields flat", () => {
    const { logger, lines } = capture();
    logger.emit("queue.job.failed", { queue: "embedding", jobId: "j1", attempt: 2 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      level: "error",
      time: AT.toISOString(),
      event: "queue.job.failed",
      queue: "embedding",
      jobId: "j1",
      attempt: 2,
    });
  });

  it("takes the level from the catalog, not the call site", () => {
    const { logger, lines } = capture({ level: "debug" });
    logger.emit("queue.job.completed", { queue: "embedding", jobId: "j1", durationMs: 4 });
    logger.emit("queue.job.failed", { queue: "embedding", jobId: "j1", attempt: 1 });

    expect(lines.map((line) => line.level)).toEqual(["debug", "error"]);
  });

  it("drops anything below the threshold", () => {
    const { logger, lines } = capture({ level: "warn" });
    logger.emit("process.started", { service: "worker" });
    logger.emit("cache.entry.corrupt", { key: "caps:u1" });

    expect(lines.map((line) => line.event)).toEqual(["cache.entry.corrupt"]);
  });
});

describe("Logger sampling", () => {
  it("keeps a sampled event when the draw falls under the rate", () => {
    const { logger, lines } = capture({ random: () => 0.05 });
    logger.emit("http.request.completed", { path: "/api/rpc", status: 200, durationMs: 12 });
    expect(lines).toHaveLength(1);
  });

  it("drops it when the draw is over", () => {
    const { logger, lines } = capture({ random: () => 0.5 });
    logger.emit("http.request.completed", { path: "/api/rpc", status: 200, durationMs: 12 });
    expect(lines).toHaveLength(0);
  });

  it("never samples an unsampled code, however the draw falls", () => {
    const { logger, lines } = capture({ random: () => 0.99 });
    logger.emit("http.request.failed", { path: "/api/rpc", status: 500, durationMs: 12 });
    expect(lines).toHaveLength(1);
  });
});

describe("Logger.failure", () => {
  it("logs an expected failure at warn, with its context flattened", () => {
    const { logger, lines } = capture();
    logger.failure(new ForbiddenError("task.reactivate", "goal-1"));

    expect(lines[0]).toMatchObject({
      level: "warn",
      event: "error.raised",
      code: "FORBIDDEN",
      permission: "task.reactivate",
      goalId: "goal-1",
    });
    expect(lines[0]?.stack).toBeUndefined();
  });

  it("logs an unexpected failure at error, and keeps the raw cause", () => {
    const { logger, lines } = capture();
    logger.failure(new InternalError(new Error('relation "users" does not exist')));

    expect(lines[0]).toMatchObject({ level: "error", code: "INTERNAL" });
    // The non-enumerable `cause` is exactly what a logger may read and the wire
    // may not — `toJSON()` cannot reach it.
    expect(String(lines[0]?.cause)).toContain('relation "users" does not exist');
    expect(String(lines[0]?.stack)).toContain("Error");
  });

  it("normalises an unrecognised throw rather than dropping it", () => {
    const { logger, lines } = capture();
    logger.failure("something fell over");

    expect(lines[0]).toMatchObject({ level: "error", code: "INTERNAL" });
    expect(String(lines[0]?.cause)).toContain("something fell over");
  });

  it("flattens field violations to their names", () => {
    const { logger, lines } = capture();
    logger.failure(
      new ValidationError([
        { field: "email", rule: "invalidFormat" },
        { field: "password", rule: "tooShort" },
      ]),
    );

    expect(lines[0]).toMatchObject({ code: "BAD_REQUEST", violations: "email,password" });
  });

  it("merges caller fields under the error's own", () => {
    const { logger, lines } = capture();
    logger.failure(new ForbiddenError("task.read"), { path: "task.list" });

    expect(lines[0]).toMatchObject({ path: "task.list", code: "FORBIDDEN" });
  });
});

describe("Logger.child", () => {
  it("merges bound fields into every line", () => {
    const { logger, lines } = capture();
    const scoped = logger.child({ traceId: "t-1" });

    scoped.emit("process.started", { service: "web" });
    scoped.failure(new ForbiddenError("task.read"));

    expect(lines.map((line) => line.traceId)).toEqual(["t-1", "t-1"]);
  });

  it("does not leak back into the parent", () => {
    const { logger, lines } = capture();
    logger.child({ traceId: "t-1" });
    logger.emit("process.started", { service: "web" });

    expect(lines[0]?.traceId).toBeUndefined();
  });

  it("nests, and the innermost binding wins", () => {
    const { logger, lines } = capture();
    logger
      .child({ traceId: "t-1" })
      .child({ traceId: "t-2", jobId: "j1" })
      .emit("process.started", {
        service: "worker",
      });

    expect(lines[0]).toMatchObject({ traceId: "t-2", jobId: "j1" });
  });

  it("redacts a sensitive field a binding dragged in", () => {
    const { logger, lines } = capture();
    logger.child({ sessionId: "sess_live_abc" }).emit("process.started", { service: "web" });

    expect(lines[0]?.sessionId).toBe(REDACTED);
  });
});
