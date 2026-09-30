import type { ArchivedObject, PartitionEstimate } from "@loadbearing/application";
import { PartitionedTable } from "@loadbearing/application";
import type { Container } from "@loadbearing/composition";
import {
  FixedClock,
  InMemoryOrganizationReader,
  InMemoryOutboxGateway,
  InMemoryPlatformPolicyRepository,
  InMemoryStoragePolicyGateway,
  RecordingMaintenanceGateway,
  RecordingPartitionArchiveGateway,
  TestContainer,
} from "@loadbearing/composition";
import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { MaintenanceConsumer } from "../../src/consumer/maintenance.consumer.js";

const NOW = new Date("2026-08-15T00:00:00Z");

// Two, and in this order: the runway walks tenants, and one tenant cannot tell a loop
// from a single call.
const FIRST = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const SECOND = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000002");
const TENANTS = [FIRST, SECOND] as const;

// Every month-partitioned table, per tenant where it has a tenant level. Derived rather
// than counted, so the next partitioned table is one allowlist line here too.
interface Run {
  readonly table: string;
  readonly organizationId: OrganizationId | null;
}

const RUNS: readonly Run[] = PartitionedTable.MONTH_PARTITIONED.flatMap((entry) =>
  entry.tenantKey
    ? TENANTS.map((organizationId): Run => ({ table: entry.name, organizationId }))
    : [{ table: entry.name, organizationId: null }],
);

const estimate = (period: Date): PartitionEstimate => ({
  name: `partition_${period.getUTCFullYear()}_${period.getUTCMonth() + 1}`,
  period,
  estimatedRows: 10,
  bytes: 1024,
});

// `TestContainer` rather than an object literal of the four members this consumer
// touches: a port added to the container is a compile error there, and was silence here.
function harness(
  options: {
    // How many entitlement adjustments the nightly sweep finds expired.
    expired?: number;
    // How many per-person grants it finds lapsed.
    lapsed?: number;
    monthsAhead?: number;
    estimates?: readonly PartitionEstimate[];
    objects?: readonly ArchivedObject[];
    lifecycle?: InMemoryStoragePolicyGateway;
  } = {},
) {
  const maintenance = new RecordingMaintenanceGateway(
    { sessions: 3, verifications: 1, invitations: 2 },
    options.monthsAhead,
    options.estimates,
  );
  const partitionArchive = new RecordingPartitionArchiveGateway(options.objects);
  const outbox = new InMemoryOutboxGateway();
  const platformPolicy = new InMemoryPlatformPolicyRepository();
  const storagePolicy = options.lifecycle ?? new InMemoryStoragePolicyGateway();
  const logger = { emit: vi.fn(), failure: vi.fn() };

  // Which tenant each unit of work was placed on. `TestContainer`'s `placed` runs the
  // work and records nothing, so an unplaced job is invisible to every other assertion.
  const placements: string[] = [];

  const clock = new FixedClock(NOW);
  const expirations: { kind: string; at: Date }[] = [];
  const platformAdmin = {
    // A stub: the use-case has its own spec; this one is about what `cleanup` does with it.
    expireAdjustments: {
      execute: (principal: { kind: string }, at: Date) => {
        expirations.push({ kind: principal.kind, at });
        return Promise.resolve({ adjustments: options.expired ?? 0 });
      },
    },
  };

  const container = {
    ...TestContainer.build({
      maintenance,
      partitionArchive,
      outbox,
      organizations: new InMemoryOrganizationReader(TENANTS),
    }),
    // The harness fixes its own epoch; this spec asserts against a later month.
    clock,
    platformAdmin,
    // A stub, as `expireAdjustments` is: the use-case has its own spec.
    overrides: {
      expire: {
        execute: (principal: { kind: string }, at: Date) => {
          expirations.push({ kind: principal.kind, at });
          return Promise.resolve({ overrides: options.lapsed ?? 0 });
        },
      },
    },
    platformPolicy,
    storagePolicy,
    logger,
    placed: <T>(principal: { organizationId: string }, work: () => Promise<T>): Promise<T> => {
      placements.push(principal.organizationId);
      return work();
    },
  } as unknown as Container;

  return {
    container,
    maintenance,
    partitionArchive,
    outbox,
    storagePolicy,
    logger,
    placements,
    expirations,
  };
}

const job = (name: string, data: unknown = {}): Job => ({ name, data }) as Job;

const emitted = (logger: { emit: ReturnType<typeof vi.fn> }, code: string) =>
  logger.emit.mock.calls.filter((call) => call[0] === code).map((call) => call[1]);

function consumerFor(container: Container): MaintenanceConsumer {
  // The Redis connection is only read by `start()`, which this spec never calls.
  return new MaintenanceConsumer(container, undefined as never, 1);
}

describe("MaintenanceConsumer", () => {
  it("throws on a job name it does not know", async () => {
    const { container, maintenance, partitionArchive } = harness();

    // A schedule renamed on one side and not the other must be loud: succeeding quietly
    // is indistinguishable from working.
    await expect(consumerFor(container).handle(job("cleanup-daily"))).rejects.toThrow(
      "Unknown maintenance job: cleanup-daily",
    );

    expect(maintenance.swept()).toEqual([]);
    expect(maintenance.partitionsEnsured()).toEqual([]);
    expect(partitionArchive.archived()).toEqual([]);
  });

  // The `archive` job and its schedule are gone: retention archives before it drops, so
  // there is no second pass left to run.
  it("no longer answers to the archive job", async () => {
    const { container } = harness();

    await expect(consumerFor(container).handle(job("archive"))).rejects.toThrow(
      "Unknown maintenance job: archive",
    );
  });

  // `partitions` covers the whole allowlist times every tenant, so its count tracks
  // those two lists rather than a literal.
  it("dispatches each known name to exactly one gateway concern", async () => {
    for (const [name, swept, ensured] of [
      ["cleanup", 1, 0],
      ["partitions", 0, RUNS.length],
    ] as const) {
      const h = harness();
      await consumerFor(h.container).handle(job(name));

      expect(h.maintenance.swept()).toHaveLength(swept);
      expect(h.maintenance.partitionsEnsured()).toHaveLength(ensured);
    }
  });

  it("sweeps against the container clock rather than a fresh Date", async () => {
    const { container, maintenance } = harness();
    await consumerFor(container).handle(job("cleanup"));

    expect(maintenance.swept()).toEqual([NOW]);
  });

  // `AX4.9`. A trial past its date already grants nothing; the sweep removes it, as the
  // system principal and at the same instant as the rest of the night's cleanup.
  it("expires entitlement adjustments on cleanup and counts them on the sweep line", async () => {
    const { container, expirations, logger } = harness({ expired: 2, lapsed: 3 });
    await consumerFor(container).handle(job("cleanup"));

    // Both sweeps, as the system principal, at the one instant the night's cleanup uses.
    expect(expirations).toEqual([
      { kind: "system", at: NOW },
      { kind: "system", at: NOW },
    ]);
    expect(emitted(logger, "maintenance.sweep.completed")[0]).toMatchObject({
      adjustments: 2,
      overrides: 3,
    });
  });

  it("keeps several months of partitions ahead of today", async () => {
    const { container, maintenance } = harness();
    await consumerFor(container).handle(job("partitions"));

    // A table with no partition for the current date rejects every insert, so one month
    // of runway makes a missed run an outage at midnight on the first.
    expect(maintenance.partitionsEnsured()[0]?.months).toBeGreaterThan(1);
    expect(maintenance.partitionsEnsured()[0]?.from).toEqual(NOW);
  });

  // The regression guard for a check that could never fire. `ensureMonthlyPartitions`
  // always leaves two months ahead, so reading the runway after it is reading its own work.
  it("reads the runway before ensuring, not after", async () => {
    const { container, maintenance } = harness();
    await consumerFor(container).handle(job("partitions"));

    const checked = maintenance.runwayChecked();
    expect(checked.map(({ table, organizationId }) => ({ table, organizationId }))).toEqual(RUNS);
    expect(checked[0]?.from).toEqual(NOW);
  });

  // The allowlist, not a name in the consumer: this is what makes a table partitioned by
  // a later migration covered by the existing schedule.
  it("ensures partitions for every table on the allowlist", () => {
    expect(PartitionedTable.NAMES).toContain(PartitionedTable.ACTIVITY_LOG);
  });

  // Every month-partitioned table once per tenant, and the one table with no tenant level
  // exactly once — which is the whole reason the outbox stays month-only.
  it("covers each allowlisted table once per tenant per run", async () => {
    const { container, maintenance } = harness();
    await consumerFor(container).handle(job("partitions"));

    expect(
      maintenance.partitionsEnsured().map(({ table, organizationId }) => ({
        table,
        organizationId,
      })),
    ).toEqual(RUNS);
  });

  // Lite has no retention pass: a month older than any window stays where it is. Nothing
  // may drop a month except a tenant delete, which archives first.
  it("archives and drops nothing, however old the month", async () => {
    const period = new Date(Date.UTC(2020, 0, 1));
    const { container, partitionArchive, logger } = harness({ estimates: [estimate(period)] });

    await consumerFor(container).handle(job("partitions"));

    expect(partitionArchive.archived()).toEqual([]);
    expect(emitted(logger, "maintenance.partition.dropped")).toEqual([]);
  });
});

// `24.1` dropped the ten foreign keys that made a leaked row impossible, so the
// guarantee moved from the database to this job. Silence is the healthy answer.
describe("MaintenanceConsumer — the orphan count", () => {
  it("says nothing when every tenant on the node is live", async () => {
    const { container, logger, maintenance } = harness();
    maintenance.orphans = [];

    await consumerFor(container).handle(job("orphans"));

    expect(emitted(logger, "maintenance.orphans.found")).toEqual([]);
  });

  // The ids, not just the count: with no foreign key left this line is the only place
  // a leaked tenant is named, and a number alone cannot be chased.
  it("names the tenants it found, and the node they are on", async () => {
    const { container, logger, maintenance } = harness();
    maintenance.orphans = [...TENANTS];

    await consumerFor(container).handle(job("orphans"));

    const found = emitted(logger, "maintenance.orphans.found");
    expect(found).toHaveLength(1);
    expect(found[0]?.tenants).toBe(TENANTS.length);
    expect(found[0]?.organizationIds).toBe(TENANTS.join(","));
    expect(found[0]?.node).toBe(0);
  });
});

// `PF.3`: the pool of pre-seeded tenants the founder claims from.
describe("MaintenanceConsumer — the spare pool", () => {
  it("tops the pool up and says how many it made", async () => {
    const { container, logger, maintenance } = harness();
    maintenance.spares = 15;

    await consumerFor(container).handle(job("spares"));

    expect(maintenance.topUps).toEqual([5]);
    const replenished = emitted(logger, "tenant.spares.replenished");
    expect(replenished).toHaveLength(1);
    expect(replenished[0]?.created).toBe(5);
  });

  it("says nothing when the pool is already full", async () => {
    const { container, logger, maintenance } = harness();
    maintenance.spares = 20;

    await consumerFor(container).handle(job("spares"));

    expect(emitted(logger, "tenant.spares.replenished")).toEqual([]);
  });
});

// `19.11`: the daily converger. Neither store is written by the save alone — a bucket
// call after the commit can fail, and a rule deleted in a console is drift.
describe("MaintenanceConsumer — the retention job", () => {
  // An empty table is the state every deployment starts in, and `export/` is the one
  // rule it still writes — once, then the comparison holds and nothing is rewritten.
  it("writes only the export rule with no rows, and nothing on the second run", async () => {
    const { container, storagePolicy, logger } = harness();

    await consumerFor(container).handle(job("retention"));
    await consumerFor(container).handle(job("retention"));

    expect(storagePolicy.applied()).toEqual([[{ prefix: "export/", expireAfterDays: 7 }]]);
    expect(emitted(logger, "retention.lifecycle.applied")).toEqual([{ rules: 1 }]);
  });

  // One line per export, not one per object. The counts are what an operator reads,
  // and nine lines a run saying the same thing is nine lines nobody reads.
  it("exports a tenant and logs the totals once", async () => {
    const { container, partitionArchive, logger } = harness();
    partitionArchive.stageExport([
      {
        table: "activity_log",
        key: "export/a/activity_log.ndjson.gz",
        rowCount: 10,
        bytes: 100,
        checksum: "x",
      },
      {
        table: "api_keys",
        key: "export/a/api_keys.ndjson.gz",
        rowCount: 2,
        bytes: 20,
        checksum: "y",
      },
    ]);

    await consumerFor(container).handle(
      job("tenant-export", { organizationId: FIRST, day: "2026-08-15" }),
    );

    expect(partitionArchive.tenantExports()).toEqual([
      { organizationId: FIRST, day: "2026-08-15" },
    ]);
    expect(emitted(logger, "cold.tenant.exported")).toEqual([
      { organizationId: FIRST, objects: 2, rows: 12, bytes: 120 },
    ]);
  });

  // Thirty days, and the line says why they went: a sweep for a deleted tenant reads
  // differently from the bucket expiring a month on its own.
  it("sweeps a deleted tenant's objects thirty days after they were archived", async () => {
    const { container, partitionArchive, logger } = harness();
    partitionArchive.stageDeleted({ organizations: 2, objects: 7 });

    await consumerFor(container).handle(job("retention"));

    expect(partitionArchive.deletedSwept()).toEqual([new Date("2026-07-16T00:00:00Z")]);
    expect(emitted(logger, "cold.objects.swept")).toEqual([
      { reason: "tenant_deleted", organizations: 2, objects: 7 },
    ]);
  });

  // No line on the common run. A nightly job emitting "swept nothing" every night is a
  // line nobody reads, which is how the one that matters gets missed.
  it("says nothing when no deleted tenant has objects left", async () => {
    const { container, logger } = harness();

    await consumerFor(container).handle(job("retention"));

    expect(emitted(logger, "cold.objects.swept")).toEqual([]);
  });
});

// `R.8`: a job that named a tenant and never placed it reached the wrong node's rows.
describe("MaintenanceConsumer — the node", () => {
  // An export reads live rows, so an unplaced one read node 0 and wrote a manifest
  // saying a tenant on another node had nothing.
  it("places tenant-export on the tenant it names", async () => {
    const { container, placements } = harness();

    await consumerFor(container).handle(
      job("tenant-export", { organizationId: SECOND, day: "2026-08-15" }),
    );

    expect(placements).toEqual([SECOND]);
  });
});
