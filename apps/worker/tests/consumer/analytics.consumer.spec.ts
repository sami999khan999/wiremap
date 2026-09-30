import type { ActivityRecord } from "@loadbearing/application";
import type { Container } from "@loadbearing/composition";
import {
  FixedClock,
  InMemoryActivityReplayReader,
  InMemoryAnalyticsProjector,
  InMemoryCacheStore,
  InMemoryColdArchiveReader,
  InMemoryOrganizationReader,
  InMemoryPlatformPolicyRepository,
  InMemoryProjectionPolicyRepository,
  RecordingPartitionArchiveGateway,
  TestContainer,
} from "@loadbearing/composition";
import { type ActivityAction, Identifiers } from "@loadbearing/contracts";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { AnalyticsConsumer } from "../../src/consumer/analytics.consumer.js";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const ORG = "018f8c00-0000-7000-8000-000000000010";
const ACTOR = "018f8c00-0000-7000-8000-000000000011";

// The projection walks tenants since `16.6`, so a harness with no tenant list projects
// nothing at all — which is also what a deployment with no organizations does.
const TENANTS = [Identifiers.organizationId.parse(ORG)];

const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const record = (id: string, occurredAt: Date, action = "task.created"): ActivityRecord => ({
  id,
  organizationId: ORG as ActivityRecord["organizationId"],
  occurredAt,
  actorId: ACTOR as ActivityRecord["actorId"],
  action,
  subjectId: null,
  payload: {},
});

function harness(
  records: readonly ActivityRecord[],
  excluded: readonly ActivityAction[] = [],
  projectionEnabled = true,
) {
  const activityReplay = new InMemoryActivityReplayReader(records);
  const analyticsProjector = new InMemoryAnalyticsProjector();
  const coldArchive = new InMemoryColdArchiveReader();
  const partitionArchive = new RecordingPartitionArchiveGateway();
  const logger = { emit: vi.fn(), failure: vi.fn() };

  const container = {
    ...TestContainer.build({
      activityReplay,
      analyticsProjector,
      coldArchive,
      partitionArchive,
      organizations: new InMemoryOrganizationReader(TENANTS),
    }),
    // The consumer reads `container.projector`; the harness names the port after the
    // abstract class. Mapping it here is what keeps both names honest.
    projector: analyticsProjector,
    platformPolicy: new InMemoryPlatformPolicyRepository({ projectionEnabled }),
    projectionPolicies: new InMemoryProjectionPolicyRepository(
      excluded.map((action) => ({ action, projected: false, ttlMonths: null })),
    ),
    clock: new FixedClock(NOW),
    logger,
  } as unknown as Container;

  return {
    consumer: new AnalyticsConsumer(container, undefined as never, 1),
    logger,
    projected: analyticsProjector,
    coldArchive,
    partitionArchive,
  };
}

const job = (name: string, data: unknown = {}): Job => ({ name, data }) as Job;

const emitted = (logger: { emit: ReturnType<typeof vi.fn> }, code: string) =>
  logger.emit.mock.calls.filter((call) => call[0] === code).map((call) => call[1]);

describe("AnalyticsConsumer project", () => {
  it("reports no lag once it has caught up, however old the newest row is", async () => {
    const { consumer, logger } = harness([record("a", minutesBefore(90))]);

    await consumer.handle(job("project"));

    // The regression: lag was the age of the *newest projected* row, so a quiet system
    // that had drained everything reported an hour and a half behind.
    expect(emitted(logger, "analytics.projection.completed")[0]).toMatchObject({
      tenants: 1,
      events: 1,
      lagSeconds: 0,
      capped: false,
    });
  });

  it("does not warn about lag on a system that is idle rather than behind", async () => {
    const { consumer, logger } = harness([record("a", minutesBefore(90))]);

    await consumer.handle(job("project"));

    // 90 minutes is well past `LAG_WARNING_MS`, so the old computation fired this every
    // run, forever, on a deployment where nothing was wrong.
    expect(emitted(logger, "analytics.projection.lagged")).toHaveLength(0);
  });

  it("reports zero against an empty audit trail", async () => {
    const { consumer, logger } = harness([]);

    await consumer.handle(job("project"));

    expect(emitted(logger, "analytics.projection.completed")[0]).toMatchObject({
      events: 0,
      lagSeconds: 0,
    });
  });
});

// `20.11`: the cold half. `activity_log`'s hot window is thirteen months and its cold
// window is years, so the day-by-day diff above sees none of it.
describe("AnalyticsConsumer reconcile over the cold window", () => {
  const month = (period: string, rowCount: number, projectedAt: Date | null) => ({
    organizationId: ORG as ActivityRecord["organizationId"],
    tableName: "activity_log" as const,
    period,
    objectKey: `cold/activity_log/${period}.ndjson.gz`,
    rowCount,
    bytes: 1,
    checksum: "x",
    actionCounts: { "ai.document.searched": 1 },
    projectedAt,
  });

  // A known gap is not drift: the Gaps panel already says so, and a second alert
  // would only repeat it with a deadline attached.
  it("skips a month the store never received", async () => {
    const { consumer, logger, partitionArchive } = harness([]);
    partitionArchive.stage([month("2024-01-01", 5, null)]);

    await consumer.handle(job("reconcile"));

    expect(emitted(logger, "analytics.reconciliation.drifted")).toEqual([]);
  });

  // The whole point: a projected month whose archived count no longer matches the
  // store is drift nothing else in this system would ever notice.
  it("reports an archived month the store is short of", async () => {
    const { consumer, logger, partitionArchive } = harness([]);
    partitionArchive.stage([month("2024-01-01", 5, new Date("2024-02-01T00:00:00.000Z"))]);

    await consumer.handle(job("reconcile"));

    expect(emitted(logger, "analytics.reconciliation.drifted")).toEqual([
      { organizationId: ORG, source: "cold", day: "2024-01-01", expected: 5, actual: 0 },
    ]);
  });

  // Off `action_counts`, which is what that column is for: without it, excluding an
  // action makes every archived month read as drift forever.
  it("subtracts the excluded actions from the archived count", async () => {
    const { consumer, logger, partitionArchive } = harness([], ["ai.document.searched"]);
    partitionArchive.stage([month("2024-01-01", 1, new Date("2024-02-01T00:00:00.000Z"))]);

    await consumer.handle(job("reconcile"));

    expect(emitted(logger, "analytics.reconciliation.drifted")).toEqual([]);
  });
});

// `20.10`: a month read back out of cold storage and into the derived store.
describe("AnalyticsConsumer reproject", () => {
  const ENTRY = {
    organizationId: ORG as ActivityRecord["organizationId"],
    tableName: "activity_log" as const,
    period: "2026-01-01",
    objectKey: "cold/activity_log/2026/01/org.ndjson.gz",
    rowCount: 2,
    bytes: 128,
    checksum: "x",
    actionCounts: {},
    projectedAt: null,
  };

  const line = (id: string, action: string) => ({
    id,
    occurred_at: "2026-01-15T00:00:00.000Z",
    actor_id: ACTOR,
    action,
    payload: {},
  });

  const staged = (excluded: readonly ActivityAction[] = []) => {
    const parts = harness([], excluded);
    parts.partitionArchive.stage([ENTRY]);
    parts.coldArchive.stage(ENTRY.objectKey, [
      line("r1", "role.created"),
      line("r2", "ai.document.searched"),
    ]);
    return parts;
  };

  it("projects the archived rows and stamps the month", async () => {
    const { consumer, projected, partitionArchive, logger } = staged();

    await consumer.handle(job("cold-reproject", { period: "2026-01-01", organizationId: null }));

    expect(
      projected
        .projected()
        .map((row) => row.id)
        .sort(),
    ).toEqual(["r1", "r2"]);
    expect(partitionArchive.projected()).toEqual([
      { table: "activity_log", period: new Date("2026-01-01T00:00:00.000Z"), organizationId: ORG },
    ]);
    expect(emitted(logger, "cold.partition.reprojected")).toEqual([
      { period: "2026-01-01", organizationId: ORG, rows: 2 },
    ]);
  });

  // The same exclusion list the live projection uses: a re-projection that ignored it
  // would put back exactly the rows the policy says not to carry.
  it("drops an excluded action on the way back in", async () => {
    const { consumer, projected } = staged(["ai.document.searched"]);

    await consumer.handle(job("cold-reproject", { period: "2026-01-01", organizationId: null }));

    expect(projected.projected().map((row) => row.id)).toEqual(["r1"]);
  });

  // Idempotent through the `ReplacingMergeTree`: a second run over the same month is
  // the same rows keyed the same way, not a doubling.
  it("is idempotent over the same month", async () => {
    const { consumer, projected } = staged();

    await consumer.handle(job("cold-reproject", { period: "2026-01-01", organizationId: null }));
    await consumer.handle(job("cold-reproject", { period: "2026-01-01", organizationId: null }));

    expect(projected.projected()).toHaveLength(2);
  });
});

// A pause, not a power switch. Off stops the consumer and nothing else — the
// connection stays and the nightly TTL convergence still runs.
describe("AnalyticsConsumer with the projection paused", () => {
  const rows = [record("a", minutesBefore(60 * 24))];

  it("projects nothing and says nothing", async () => {
    const { consumer, logger, projected } = harness(rows, [], false);

    await consumer.handle(job("project"));

    expect(projected.projected()).toEqual([]);
    // **No line.** 288 a day saying "paused" is noise, and the screen shows the state.
    expect(logger.emit).not.toHaveBeenCalled();
  });

  it("reconciles nothing, so a pause is not an alert storm", async () => {
    const { consumer, logger } = harness(rows, [], false);

    await consumer.handle(job("reconcile"));

    expect(emitted(logger, "analytics.reconciliation.drifted")).toEqual([]);
    expect(emitted(logger, "analytics.reconciliation.completed")).toEqual([]);
  });

  // Resume needs no state: the checkpoint is read from the destination, so the rows
  // written while it was off are exactly the ones the next run picks up.
  it("picks the backlog up on resume with no state to restore", async () => {
    const paused = harness(rows, [], false);
    await paused.consumer.handle(job("project"));

    const resumed = harness(rows, [], true);
    await resumed.consumer.handle(job("project"));

    expect(resumed.projected.projected().map((row) => row.id)).toEqual(["a"]);
  });
});

// One exclusion list, read once per run and passed to all three queries. Both sides of
// the reconciliation have to subtract it, which is what makes it worth a spec.
describe("AnalyticsConsumer with an excluded action", () => {
  const rows = [
    record("a", minutesBefore(60 * 24), "ai.document.searched"),
    record("b", minutesBefore(60 * 24), "role.created"),
  ];

  it("projects the kept action and not the excluded one", async () => {
    const { consumer, projected } = harness(rows, ["ai.document.searched"]);

    await consumer.handle(job("project"));

    expect(projected.projected().map((row) => row.id)).toEqual(["b"]);
  });

  // The one that matters: subtracted from the source only, every excluded row reads as
  // drift on the run after it was excluded — a reconciliation that cries wolf forever.
  it("reconciles to zero drift, because both sides subtract the same list", async () => {
    const { consumer, logger } = harness(rows, ["ai.document.searched"]);

    await consumer.handle(job("project"));
    await consumer.handle(job("reconcile"));

    expect(emitted(logger, "analytics.reconciliation.drifted")).toHaveLength(0);
    expect(emitted(logger, "analytics.reconciliation.completed")[0]).toMatchObject({ drifted: 0 });
  });

  // An absent row is "projected", so a table with nothing in it must behave exactly as
  // the deploy before the table existed.
  it("projects everything when nothing is excluded", async () => {
    const { consumer, projected } = harness(rows);

    await consumer.handle(job("project"));

    expect(projected.projected()).toHaveLength(2);
  });
});

describe("AnalyticsConsumer reconcile", () => {
  it("completes with a drift count of zero when both sides agree", async () => {
    const { consumer, logger } = harness([record("a", minutesBefore(60 * 24))]);

    await consumer.handle(job("project"));
    await consumer.handle(job("reconcile"));

    expect(emitted(logger, "analytics.reconciliation.drifted")).toHaveLength(0);
    expect(emitted(logger, "analytics.reconciliation.completed")[0]).toMatchObject({ drifted: 0 });
  });

  it("still completes when it found drift, and says how much", async () => {
    // Projected nothing, so every day in the window is short by its whole count.
    const { consumer, logger } = harness([record("a", minutesBefore(60 * 24))]);

    await consumer.handle(job("reconcile"));

    const drift = emitted(logger, "analytics.reconciliation.drifted");
    expect(drift).toHaveLength(1);
    // Per tenant, because both sides answer per tenant: a drifting day belongs to one.
    expect(drift[0]).toMatchObject({ organizationId: ORG });

    // The regression: it returned early, so a reconciliation that was finding drift and
    // a consumer that had stopped were the same absence on a dashboard.
    expect(emitted(logger, "analytics.reconciliation.completed")[0]).toMatchObject({
      days: 1,
      drifted: 1,
    });
  });
});

// `R.25`. `occurred_at` is stamped when a transaction starts and rows commit out of that
// order, so a row can become visible below a checkpoint that has already passed it.
describe("AnalyticsConsumer project — the settle horizon", () => {
  const secondsBefore = (seconds: number) => new Date(NOW.getTime() - seconds * 1_000);

  it("leaves a row inside the settle window for the next run", async () => {
    const { consumer, projected } = harness([
      record("a", secondsBefore(120)),
      // Ten seconds old, so a transaction that started at the same instant and has not
      // committed yet would land underneath it.
      record("b", secondsBefore(10)),
    ]);

    await consumer.handle(job("project"));

    expect(projected.projected().map((row) => row.id)).toEqual(["a"]);
  });

  // The other half: the horizon is a delay, never a filter. A row that has settled is
  // projected on the run after the one that skipped it.
  it("projects it once it is older than the window", async () => {
    const { consumer, projected } = harness([record("b", secondsBefore(45))]);

    await consumer.handle(job("project"));

    expect(projected.projected().map((row) => row.id)).toEqual(["b"]);
  });

  // Lag takes the same horizon. Measured without it, a run reports a backlog made
  // entirely of rows the walk was never going to reach, and the alert never clears.
  it("reports no lag for a backlog that is all inside the window", async () => {
    const { consumer, logger } = harness([record("b", secondsBefore(5))]);

    await consumer.handle(job("project"));

    expect(emitted(logger, "analytics.projection.completed")[0]).toMatchObject({
      events: 0,
      lagSeconds: 0,
    });
  });
});

// `23.21`, decided 2026-09-25: **skip**. A tenant in `organizations` with no
// `shard_assignments` row is passed over and named; every other tenant still projects.
describe("AnalyticsConsumer — a tenant that cannot be placed", () => {
  const SECOND = "018f8c00-0000-7000-8000-000000000020";

  function unplaceable(directory: "missing" | "down" = "missing") {
    const activityReplay = new InMemoryActivityReplayReader([record("a", minutesBefore(5))]);
    const analyticsProjector = new InMemoryAnalyticsProjector();
    const logger = { emit: vi.fn(), failure: vi.fn() };

    const container = {
      ...TestContainer.build({
        activityReplay,
        analyticsProjector,
        // The unplaceable tenant first, so a skip that stopped the walk would show.
        organizations: new InMemoryOrganizationReader([
          Identifiers.organizationId.parse(SECOND),
          Identifiers.organizationId.parse(ORG),
        ]),
      }),
      projector: analyticsProjector,
      platformPolicy: new InMemoryPlatformPolicyRepository({ projectionEnabled: true }),
      projectionPolicies: new InMemoryProjectionPolicyRepository([]),
      clock: new FixedClock(NOW),
      logger,
      // What the resolver does for a tenant the directory has no row for.
      placed: <T>(principal: { organizationId: string }, work: () => Promise<T>) => {
        if (principal.organizationId === SECOND) {
          return Promise.reject(new Error(`No shard assignment for ${SECOND}.`));
        }
        return work();
      },
      // `down` is the catalog failing, which must still fail the run rather than skip.
      shardAssignments: {
        findByKey: (key: string) => {
          if (directory === "down") return Promise.reject(new Error("catalog unreachable"));
          return Promise.resolve(key === SECOND ? null : { key, node: 0 });
        },
      },
    } as unknown as Container;

    return {
      consumer: new AnalyticsConsumer(container, undefined as never, 1),
      logger,
      projected: analyticsProjector,
    };
  }

  it("skips it, names it, and projects every other tenant", async () => {
    const { consumer, logger, projected } = unplaceable();

    await consumer.handle(job("project"));

    expect(emitted(logger, "analytics.tenant.skipped")).toEqual([
      { organizationId: SECOND, job: "project" },
    ]);
    expect(emitted(logger, "analytics.projection.failed")).toEqual([]);
    expect(emitted(logger, "analytics.projection.completed")[0]).toMatchObject({
      tenants: 2,
      skipped: 1,
      events: 1,
    });
    expect(await projected.checkpoint(Identifiers.organizationId.parse(ORG))).toMatchObject({
      lastId: "a",
    });
  });

  it("skips it in the reconciliation too", async () => {
    const { consumer, logger } = unplaceable();

    await consumer.handle(job("reconcile"));

    expect(emitted(logger, "analytics.tenant.skipped")).toEqual([
      { organizationId: SECOND, job: "reconcile" },
    ]);
    expect(emitted(logger, "analytics.reconciliation.completed")).toHaveLength(1);
  });

  // The skip is for a missing row, never for a failure to ask: a catalog outage that
  // skipped every tenant would read as a quiet, successful run.
  // ──
  // `CR.44`: and the lookup's own error must not replace the one it follows, or the
  // failure line is never emitted. `CR.20`: the tenants after it still project.
  it("still fails the run when the directory cannot be asked, with the original error", async () => {
    const { consumer, logger, projected } = unplaceable("down");

    await expect(consumer.handle(job("project"))).rejects.toThrow("No shard assignment");
    expect(emitted(logger, "analytics.tenant.skipped")).toEqual([]);
    expect(emitted(logger, "analytics.projection.failed")).toEqual([
      { projection: "activity_events", organizationId: SECOND, eventId: "none" },
    ]);
    expect(emitted(logger, "analytics.projection.completed")[0]).toMatchObject({ failed: 1 });
    expect(await projected.checkpoint(Identifiers.organizationId.parse(ORG))).toMatchObject({
      lastId: "a",
    });
  });
});

// `24.3`. The switch is read once per run and rides on every tenant's placement; the
// repository decides what to do with it. Every job is placed with `recheck` — `24.2b`.
describe("AnalyticsConsumer — the replica switch", () => {
  function switched(replicaReadsEnabled: boolean) {
    const placements: { recheck?: boolean; replica?: boolean }[] = [];
    const analyticsProjector = new InMemoryAnalyticsProjector();

    const container = {
      ...TestContainer.build({
        activityReplay: new InMemoryActivityReplayReader([record("a", minutesBefore(5))]),
        analyticsProjector,
        organizations: new InMemoryOrganizationReader(TENANTS),
      }),
      projector: analyticsProjector,
      platformPolicy: new InMemoryPlatformPolicyRepository({ replicaReadsEnabled }),
      projectionPolicies: new InMemoryProjectionPolicyRepository([]),
      clock: new FixedClock(NOW),
      logger: { emit: vi.fn(), failure: vi.fn() },
      placed: <T>(
        _principal: unknown,
        work: () => Promise<T>,
        options: { recheck?: boolean; replica?: boolean } = {},
      ) => {
        placements.push(options);
        return work();
      },
    } as unknown as Container;

    return { consumer: new AnalyticsConsumer(container, undefined as never, 1), placements };
  }

  it.each([true, false])("places the projection with the switch %s", async (enabled) => {
    const { consumer, placements } = switched(enabled);

    await consumer.handle(job("project"));

    expect(placements).toEqual([{ recheck: true, replica: enabled }]);
  });

  it("places the reconciliation with the switch too", async () => {
    const { consumer, placements } = switched(true);

    await consumer.handle(job("reconcile"));

    expect(placements).toEqual([{ recheck: true, replica: true }]);
  });
});

// `CR.20`. Every run started at the first tenant and spent the budget first come, first
// served, so a large backlog early in id order starved everyone after it, unmeasured.
describe("AnalyticsConsumer — where a run starts", () => {
  const FIRST = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
  const SECOND = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000002");
  const THIRD = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000003");

  function rotating() {
    const visited: string[] = [];
    const cache = new InMemoryCacheStore();
    const logger = { emit: vi.fn(), failure: vi.fn() };
    const analyticsProjector = new InMemoryAnalyticsProjector();

    const container = {
      ...TestContainer.build({
        activityReplay: new InMemoryActivityReplayReader([]),
        analyticsProjector,
        cache,
        organizations: new InMemoryOrganizationReader([FIRST, SECOND, THIRD]),
      }),
      projector: analyticsProjector,
      platformPolicy: new InMemoryPlatformPolicyRepository({ projectionEnabled: true }),
      projectionPolicies: new InMemoryProjectionPolicyRepository([]),
      clock: new FixedClock(NOW),
      logger,
      placed: <T>(principal: { organizationId: string }, work: () => Promise<T>) => {
        visited.push(principal.organizationId);
        return work();
      },
    } as unknown as Container;

    return { consumer: new AnalyticsConsumer(container, undefined as never, 1), cache, visited };
  }

  it("starts after the tenant the last run stopped at, and wraps round to it", async () => {
    const { consumer, cache, visited } = rotating();
    await cache.set("analytics:project:cursor", SECOND, 60);

    await consumer.handle(job("project"));

    expect(visited).toEqual([THIRD, FIRST, SECOND]);
    expect(await cache.get("analytics:project:cursor")).toBe(SECOND);
  });

  // The store down is every tenant failing, and a line each for every tenant every five
  // minutes was the flood a dev stack without ClickHouse produced. Three, then stop.
  it("stops after three failures in a row, which is the store rather than a tenant", async () => {
    const tenants = Array.from({ length: 6 }, (_, index) =>
      Identifiers.organizationId.parse(`018f8c00-0000-7000-8000-00000000003${index}`),
    );
    const logger = { emit: vi.fn(), failure: vi.fn() };
    const container = {
      ...TestContainer.build({
        activityReplay: new InMemoryActivityReplayReader([]),
        organizations: new InMemoryOrganizationReader(tenants),
      }),
      projector: new InMemoryAnalyticsProjector(),
      platformPolicy: new InMemoryPlatformPolicyRepository({ projectionEnabled: true }),
      projectionPolicies: new InMemoryProjectionPolicyRepository([]),
      clock: new FixedClock(NOW),
      logger,
      placed: () => Promise.reject(new Error("clickhouse unreachable")),
      shardAssignments: { findByKey: (key: string) => Promise.resolve({ key, node: 0 }) },
    } as unknown as Container;

    await expect(
      new AnalyticsConsumer(container, undefined as never, 1).handle(job("project")),
    ).rejects.toThrow("clickhouse unreachable");
    expect(emitted(logger, "analytics.projection.failed")).toHaveLength(3);
  });

  it("starts at the first tenant when there is no cursor", async () => {
    const { consumer, visited } = rotating();

    await consumer.handle(job("project"));

    expect(visited).toEqual([FIRST, SECOND, THIRD]);
  });
});
