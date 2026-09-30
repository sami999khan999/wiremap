import { FixedClock } from "@loadbearing/core";
import { InternalError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { EVENT_CATALOG } from "../../src/catalog/index.js";
import { JsonLogger } from "../../src/logger/json.logger.js";

// The shape the big kit's Alloy config parses. Lite ships logs to stdout only, and this
// is what keeps a line readable by that pipeline the day it is ported back.

const AT = new Date("2026-01-01T00:00:00.000Z");

// Exactly the four the pipeline promotes. Adding to this set is a Loki decision,
// not a logging one — see docs/opinions/data-and-scale.md.
const LABELS = ["app", "env", "level", "event_code"] as const;

function capture(bound?: Record<string, string>) {
  const lines: Record<string, unknown>[] = [];
  const logger = new JsonLogger({
    clock: new FixedClock(AT),
    random: () => 0,
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    ...(bound ? { bound } : {}),
  });
  return { logger, lines };
}

describe("the wire contract a log shipper depends on", () => {
  it("puts `level` and `event` at the top level, where stage.json reads them", () => {
    const { logger, lines } = capture();
    logger.emit("queue.job.failed", { queue: "embedding", jobId: "j1", attempt: 2 });

    // Not `entry.level` or `fields.level`: the JSON stage addresses these by bare name,
    // so nesting either silently produces unlabelled streams.
    expect(lines[0]).toHaveProperty("level", "error");
    expect(lines[0]).toHaveProperty("event", "queue.job.failed");
  });

  it("carries `app` and `env` when the container binds them", () => {
    const { logger, lines } = capture({ app: "web", env: "production" });
    logger.emit("process.started", { service: "web" });

    expect(lines[0]).toMatchObject({ app: "web", env: "production" });
  });

  it("keeps high-cardinality identifiers in the body, never at label position", () => {
    const { logger, lines } = capture({ app: "web", env: "production" });
    logger.child({ traceId: "0195abc", organizationId: "org-1" }).emit("http.request.failed", {
      path: "/api/rpc",
      status: 500,
      durationMs: 12,
    });

    const line = lines[0] ?? {};

    // They must be present — a trace id nobody can filter on is useless...
    expect(line).toMatchObject({ traceId: "0195abc", organizationId: "org-1" });
    // ...and they must not be one of the four the pipeline promotes.
    for (const field of ["traceId", "organizationId", "path", "status", "durationMs"]) {
      expect(LABELS).not.toContain(field);
    }
  });

  it("emits `error.raised`, which is a label value with no catalog entry", () => {
    const { logger, lines } = capture();
    logger.failure(new InternalError());

    // `event_code` is a Loki label, so its cardinality budget is EVENT_CATALOG *plus
    // this one* — which takes its level from ERROR_CATALOG instead.
    expect(lines[0]).toHaveProperty("event", "error.raised");
    expect(Object.keys(EVENT_CATALOG)).not.toContain("error.raised");
  });

  it("stops being parseable when pretty-printing is on", () => {
    const lines: string[] = [];
    const logger = new JsonLogger({
      clock: new FixedClock(AT),
      pretty: true,
      sink: (line) => lines.push(line),
    });
    logger.emit("process.started", { service: "web" });

    // Why LOG_PRETTY must be false anywhere Alloy is reading: it is a terminal format,
    // and `stage.json` drops what it cannot parse.
    expect(() => JSON.parse(lines[0] ?? "")).toThrow();
  });
});
