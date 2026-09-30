import type {
  ArchivedObject,
  PartitionArchiveEntry,
  PartitionEstimate,
  RetentionPolicyRecord,
  TenantRetentionPolicyRecord,
} from "@loadbearing/application";
import { PartitionedTable } from "@loadbearing/application";
import type { Container } from "@loadbearing/composition";
import {
  FixedClock,
  InMemoryOrganizationReader,
  InMemoryOutboxGateway,
  InMemoryPlatformPolicyRepository,
  InMemoryRetentionPolicyRepository,
  InMemoryStoragePolicyGateway,
  InMemoryTenantRetentionPolicyRepository,
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

// Every table the calendar drops something from. `doc_revision` is an archive path and is never
// dropped, so a prune pass that touched it would be the bug.
const RETAINED = PartitionedTable.MONTH_PARTITIONED.filter(
  (entry) => entry.retentionMonths !== null,
);

const estimate = (period: Date): PartitionEstimate => ({
  name: `partition_${period.getUTCFullYear()}_${period.getUTCMonth() + 1}`,
  period,
  estimatedRows: 10,
  bytes: 1024,
});

// `TestContainer` rather than an object literal of the four members this consumer
// touches: a port added to the container is a compile error there, and was silence here.
const archived = (organizationId: OrganizationId): ArchivedObject => ({
  organizationId,
  key: `cold/activity_log/2024/01/${organizationId}.ndjson.gz`,
  rowCount: 4,
  bytes: 512,
  checksum: "sha-512",
  actionCounts: { "task.created": 4 },
});

function harness(
  options: {
    // How many entitlement adjustments the nightly sweep finds expired.
    expired?: number;
    // How many per-person grants it finds lapsed.
    lapsed?: number;
    monthsAhead?: number;
    estimates?: readonly PartitionEstimate[];
    objects?: readonly ArchivedObject[];
    // Empty by default, which is the state that matters: an absent row is the code
    // default, so most of these cases assert the allowlist's own numbers.
    policies?: readonly RetentionPolicyRecord[];
    // An override is what makes the prune pass walk tenants rather than months, so
    // most cases here stage none and assert the table-month path.
    tenantPolicies?: readonly TenantRetentionPolicyRecord[];
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
  const retentionPolicies = new InMemoryRetentionPolicyRepository(options.policies);
  const platformPolicy = new InMemoryPlatformPolicyRepository();
  const tenantRetentionPolicies = new InMemoryTenantRetentionPolicyRepository(
    options.tenantPolicies,
  );
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
    retentionPolicies,
    platformPolicy,
    tenantRetentionPolicies,
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
    retentionPolicies,
    tenantRetentionPolicies,
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

  it("archives nothing when no partition is older than the cutoff", async () => {
    const { container, partitionArchive } = harness();
    await consumerFor(container).handle(job("partitions"));

    expect(partitionArchive.archived()).toEqual([]);
  });

  // Retention stops meaning deletion: a month that ages out leaves through the archive,
  // and the drop is the gateway's last step behind a verified object.
  it("archives every table-month older than the cutoff, once per table-month", async () => {
    const period = new Date(Date.UTC(2024, 0, 1));
    const { container, partitionArchive, logger } = harness({
      estimates: [estimate(period), estimate(period)],
    });

    await consumerFor(container).handle(job("partitions"));

    // One call and one line per table-month, `organizationId: null` meaning every
    // tenant — five thousand tenants must not be five thousand lines.
    expect(partitionArchive.archived()).toEqual(
      RETAINED.map((entry) => ({ table: entry.name, period, organizationId: null })),
    );
    expect(emitted(logger, "maintenance.partition.archived")).toHaveLength(RETAINED.length);
  });

  // A stuck event must never leave by the calendar, and the guard is the outbox's alone:
  // applying it to every table would let one block them all.
  it("leaves the outbox alone while the drain is behind", async () => {
    const period = new Date(Date.UTC(2024, 0, 1));
    const { container, partitionArchive, outbox } = harness({ estimates: [estimate(period)] });

    outbox.enqueue({
      name: "task.created",
      organizationId: FIRST,
      actorId: FIRST as never,
      occurredAt: period,
      payload: {},
    } as never);

    await consumerFor(container).handle(job("partitions"));

    expect(partitionArchive.archived().map(({ table }) => table)).not.toContain(
      PartitionedTable.OUTBOX_EVENT,
    );
  });

  // A month is archived and dropped whether or not the derived store has it. A forgotten
  // switch costs a known hole, never an unbounded table.
  it("records a projection gap for every archived month of the audit trail", async () => {
    const period = new Date(Date.UTC(2024, 0, 1));
    const { container, partitionArchive, logger } = harness({
      estimates: [estimate(period)],
      objects: [archived(FIRST)],
    });

    await consumerFor(container).handle(job("partitions"));

    expect(emitted(logger, "analytics.projection.gap")).toEqual([
      { period: "2024-01-01", reason: "disabled" },
    ]);
    expect(partitionArchive.projected()).toEqual([]);
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
  const cold = (tableName: string, coldMonths: number | null): RetentionPolicyRecord => ({
    store: "postgres",
    tableName,
    hotMonths: 12,
    coldMonths,
    coldMode: "archive",
  });

  it("writes the bucket's configuration when it does not match the rows", async () => {
    const { container, storagePolicy, logger } = harness({
      policies: [cold("activity_log", 24)],
    });

    await consumerFor(container).handle(job("retention"));

    expect(await storagePolicy.lifecycle()).toEqual([
      { prefix: "cold/activity_log/", expireAfterDays: 731 },
      // Not composed from a row: an export is a copy of a tenant's data in a bucket,
      // and seven days is how long that is a download rather than a liability.
      { prefix: "export/", expireAfterDays: 7 },
    ]);
    // Drift first, then the repair: a lone `applied` cannot tell "the reconcile is
    // doing its job" from "somebody edited the bucket by hand last night".
    expect(emitted(logger, "retention.lifecycle.drifted")).toHaveLength(1);
    expect(emitted(logger, "retention.lifecycle.applied")).toEqual([{ rules: 2 }]);
  });

  // The one that matters most: `PutBucketLifecycleConfiguration` replaces everything,
  // so a job that wrote on every run would rewrite the bucket daily for no reason.
  it("writes nothing on the second run", async () => {
    const { container, storagePolicy, logger } = harness({
      policies: [cold("activity_log", 24)],
    });

    await consumerFor(container).handle(job("retention"));
    await consumerFor(container).handle(job("retention"));

    expect(storagePolicy.applied()).toHaveLength(1);
    expect(emitted(logger, "retention.lifecycle.applied")).toHaveLength(1);
  });

  // An empty table is the state every deployment starts in, and `export/` is the one
  // rule it still writes — once, then the comparison holds and nothing is rewritten.
  it("writes only the export rule with no rows, and nothing on the second run", async () => {
    const { container, storagePolicy, logger } = harness();

    await consumerFor(container).handle(job("retention"));
    await consumerFor(container).handle(job("retention"));

    expect(storagePolicy.applied()).toEqual([[{ prefix: "export/", expireAfterDays: 7 }]]);
    expect(emitted(logger, "retention.lifecycle.applied")).toEqual([{ rules: 1 }]);
  });

  // `25.3`. The tier is the gateway's, so the converger composes with it, and a bucket
  // that lost its transition by hand is put back rather than read as settled.
  it("writes the cold tier's transition, and restores one removed by hand", async () => {
    const tier = { storageClass: "COLD", afterDays: 30 };
    const storagePolicy = new InMemoryStoragePolicyGateway(tier);
    const { container, logger } = harness({
      policies: [cold("activity_log", 24)],
      lifecycle: storagePolicy,
    });

    await consumerFor(container).handle(job("retention"));
    expect(await storagePolicy.lifecycle()).toEqual([
      { prefix: "cold/activity_log/", expireAfterDays: 731, transition: tier },
      { prefix: "export/", expireAfterDays: 7 },
    ]);

    await storagePolicy.applyLifecycle([
      { prefix: "cold/activity_log/", expireAfterDays: 731 },
      { prefix: "export/", expireAfterDays: 7 },
    ]);
    await consumerFor(container).handle(job("retention"));

    expect(storagePolicy.applied()).toHaveLength(3);
    expect(emitted(logger, "retention.lifecycle.drifted")[1]).toMatchObject({
      expected: "cold/activity_log/=731>COLD@30|export/=7",
      actual: "cold/activity_log/=731|export/=7",
    });
  });

  // The rows only. The bucket's own rule deleted the object; a row still pointing at one
  // is a `NotFoundError` on a read that should have been an empty list.
  it("forgets an archive row past its hot plus cold window", async () => {
    const { container, partitionArchive } = harness({ policies: [cold("activity_log", 24)] });

    await consumerFor(container).handle(job("retention"));

    // 2026-08 less thirty-six months.
    expect(partitionArchive.forgets()).toEqual([
      { table: "activity_log", period: new Date(Date.UTC(2023, 7, 1)) },
    ]);
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

  it("forgets nothing for a table whose objects never expire", async () => {
    const { container, partitionArchive } = harness({ policies: [cold("activity_log", null)] });

    await consumerFor(container).handle(job("retention"));

    expect(partitionArchive.forgets()).toEqual([]);
  });
});

// `19.10`: an absent row is the code default, and a row replaces it.
describe("MaintenanceConsumer — prune reads the row", () => {
  const period = new Date(Date.UTC(2024, 0, 1));

  it("uses the allowlist when no row exists", async () => {
    const { container, partitionArchive } = harness({ estimates: [estimate(period)] });

    await consumerFor(container).handle(job("partitions"));

    // `activity_log` at thirteen months and `notifications` at twelve, from the
    // allowlist alone. `doc_revision` is never retired and contributes nothing.
    expect(partitionArchive.archived().map(({ table }) => table)).toEqual(
      RETAINED.map((entry) => entry.name),
    );
  });

  // The whole point of the row: a table the allowlist never retires becomes one that
  // does, with no deploy.
  it("retires a table the allowlist leaves alone when a row says so", async () => {
    const { container, partitionArchive } = harness({
      estimates: [estimate(period)],
      policies: [
        {
          store: "postgres",
          tableName: "doc_revision",
          hotMonths: 6,
          coldMonths: null,
          coldMode: "archive",
        },
      ],
    });

    await consumerFor(container).handle(job("partitions"));

    expect(partitionArchive.archived().map(({ table }) => table)).toContain("doc_revision");
  });

  // `drop` destroys the month rather than archiving it — a table of transport rows
  // deciding it is not worth the bytes. Nothing reaches cold storage.
  it("drops rather than archives under cold_mode drop", async () => {
    const { container, partitionArchive, maintenance } = harness({
      estimates: [estimate(period)],
      policies: [
        {
          store: "postgres",
          tableName: "notifications",
          hotMonths: 12,
          coldMonths: null,
          coldMode: "drop",
        },
      ],
    });

    await consumerFor(container).handle(job("partitions"));

    expect(partitionArchive.archived().map(({ table }) => table)).not.toContain("notifications");
    expect(maintenance.partitionsDropped().map(({ table }) => table)).toContain("notifications");
  });
});

// `19.19`: `override ?? retention_policy row ?? allowlist`, per tenant. The pass walks
// tenants only when an override exists, which keeps the common case one call.
describe("MaintenanceConsumer — a per-tenant retention override", () => {
  const period = new Date(Date.UTC(2024, 0, 1));

  const override = (
    organizationId: OrganizationId,
    hotMonths: number,
  ): TenantRetentionPolicyRecord => ({
    organizationId,
    tableName: "activity_log",
    hotMonths,
    coldMonths: null,
  });

  it("archives per tenant once an override exists", async () => {
    const { container, partitionArchive } = harness({
      estimates: [estimate(period)],
      tenantPolicies: [override(FIRST, 3)],
    });

    await consumerFor(container).handle(job("partitions"));

    // Both tenants, named: the override made the pass walk them, and `SECOND` takes the
    // table default rather than being skipped.
    const activityLog = partitionArchive.archived().filter(({ table }) => table === "activity_log");

    expect(activityLog.map(({ organizationId }) => organizationId)).toEqual([FIRST, SECOND]);
  });

  // The table the override does not name keeps the cheap path. Otherwise one override
  // anywhere would turn every table's pass into a tenant walk.
  it("leaves the other tables on the table-month path", async () => {
    const { container, partitionArchive } = harness({
      estimates: [estimate(period)],
      tenantPolicies: [override(FIRST, 3)],
    });

    await consumerFor(container).handle(job("partitions"));

    const notifications = partitionArchive
      .archived()
      .filter(({ table }) => table === "notifications");

    expect(notifications.map(({ organizationId }) => organizationId)).toEqual([null]);
  });

  // Why `update-tenant-retention` refuses one: `prune` returns before it reads an
  // override on a table whose default is null, so the setting would do nothing.
  it("does not retire a table whose default is never, even with a row", async () => {
    const { container, partitionArchive } = harness({
      estimates: [estimate(period)],
      tenantPolicies: [{ ...override(FIRST, 3), tableName: "doc_revision" }],
    });

    await consumerFor(container).handle(job("partitions"));

    expect(partitionArchive.archived().map(({ table }) => table)).not.toContain("doc_revision");
  });
});

// `R.6`, `R.8`: two ways a pass reached the wrong rows — a mode that skipped the
// overrides, and two jobs that named a tenant and never placed it.
describe("MaintenanceConsumer — the overrides and the node", () => {
  const period = new Date(Date.UTC(2024, 0, 1));

  const entry = (organizationId: OrganizationId): PartitionArchiveEntry => ({
    organizationId,
    tableName: "activity_log",
    period: "2024-01-01",
    objectKey: `cold/activity_log/2024/01/${organizationId}.ndjson.gz`,
    rowCount: 4,
    bytes: 512,
    checksum: "sha-512",
    actionCounts: {},
    projectedAt: null,
  });

  // `drop` destroys the month. Branching on the mode before reading the overrides meant
  // a tenant that had paid for three years lost the month at the deployment's cutoff.
  it("honours a per-tenant override under cold_mode drop", async () => {
    const { container, maintenance } = harness({
      estimates: [estimate(period)],
      policies: [
        {
          store: "postgres",
          tableName: "activity_log",
          hotMonths: 12,
          coldMonths: null,
          coldMode: "drop",
        },
      ],
      tenantPolicies: [
        { organizationId: FIRST, tableName: "activity_log", hotMonths: 36, coldMonths: null },
      ],
    });

    await consumerFor(container).handle(job("partitions"));

    const drops = maintenance
      .partitionsDropped()
      .filter(({ table }) => table === "activity_log")
      .map(({ organizationId, cutoff }) => ({ organizationId, cutoff: cutoff.toISOString() }));

    // One drop per tenant at its own cutoff, never one table-wide drop at the
    // deployment's. `SECOND` has no override and keeps the row's twelve months.
    expect(drops).toEqual([
      { organizationId: FIRST, cutoff: "2023-08-01T00:00:00.000Z" },
      { organizationId: SECOND, cutoff: "2025-08-01T00:00:00.000Z" },
    ]);
  });

  // The archive index is catalog and the scratch table is the tenant's. Unplaced, the
  // restore wrote node 0 and a tenant on another node got somebody else's table.
  it("places cold-restore on the tenant that owns the object", async () => {
    const { container, partitionArchive, placements } = harness();
    partitionArchive.stage([entry(SECOND)]);

    await consumerFor(container).handle(
      job("cold-restore", { table: "activity_log", period: "2024-01-01", organizationId: null }),
    );

    expect(placements).toEqual([SECOND]);
  });

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
