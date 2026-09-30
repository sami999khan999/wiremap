import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TestContainer } from "../../src/container/test-container.js";
import { RecordingActivityLogger, RecordingQueuePublisher } from "../../src/fake/index.js";

// Resolved from this file rather than `process.cwd()`, so the assertion holds whether
// vitest is run from the package or from the workspace root.
const PORT_DIR = fileURLToPath(new URL("../../../application/src/port/", import.meta.url));

// The harness entries that are not ports: three shared primitives, the two placement
// helpers, and the content source, whose abstract class lives in `@loadbearing/content`.
const NOT_PORTS = ["authorizer", "clock", "content", "eachShard", "logger", "placed"] as const;

describe("TestContainer", () => {
  it("builds every port without touching infrastructure", () => {
    const harness = TestContainer.build();

    // Every key, from the object rather than by hand: a listed subset passes while
    // a port added to `TestPorts` goes unbuilt, which is what this once did.
    for (const [name, port] of Object.entries(harness)) {
      expect(port, `${name} is not built`).toBeDefined();
    }
  });

  // Counted off the directory rather than restated, which is the difference between a
  // list that goes stale and one that fails the run the next port is added.
  it("builds one port per abstract class in application/src/port", () => {
    const harness = TestContainer.build();
    const ports = readdirSync(PORT_DIR).filter(
      (file) => file.endsWith(".ts") && file !== "index.ts",
    );

    // `content` has no port file — `ContentSource` is `@loadbearing/content`'s, and its
    // real implementation is the test double. The other three are shared primitives.
    expect(Object.keys(harness)).toHaveLength(ports.length + NOT_PORTS.length);
    expect(Object.keys(harness).sort()).toEqual([
      "activity",
      "activityReplay",
      "analyticsProjector",
      "authorizer",
      "cache",
      "capabilities",
      "clock",
      "coldArchive",
      "content",
      "eachShard",
      "email",
      "embeddings",
      "events",
      "logger",
      "logs",
      "mailPublisher",
      "mailRenderer",
      "maintenance",
      "markdownRenderer",
      "organizations",
      "outbox",
      "partitionArchive",
      "placed",
      "queue",
      "rateLimits",
      "realtime",
      "realtimeSubscriber",
      "relayedActivity",
      "sessions",
      "shardAssignments",
      "shardResolver",
      "sharding",
      "signOuts",
      "storage",
      "storagePolicy",
      "tenantMemberships",
      "tenantMove",
      "unitOfWork",
      "users",
      "vectors",
    ]);
  });

  it("freezes the clock at the same instant every run", () => {
    expect(TestContainer.build().clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("hands the override back rather than the default", () => {
    const activity = new RecordingActivityLogger();
    const harness = TestContainer.build({ activity });

    expect(harness.activity).toBe(activity);
  });

  it("leaves the un-overridden ports on their defaults", () => {
    const queue = new RecordingQueuePublisher();
    const harness = TestContainer.build({ queue });

    expect(harness.queue).toBe(queue);
    expect(harness.cache).not.toBe(queue);
  });

  it("emits without a console mock", () => {
    // The point of `SilentLogger` here: a use-case spec that logs needs no stubbing,
    // and nothing reaches stdout to pollute the run.
    expect(() => {
      TestContainer.build().logger.emit("process.started", { service: "test" });
    }).not.toThrow();
  });
});
