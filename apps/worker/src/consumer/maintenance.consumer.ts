import { SystemPrincipal, withShard } from "../bootstrap/index.js";
import {
  type ArchivedPartition,
  type ColdMode,
  type Container,
  type Job,
  type OrganizationId,
  PartitionedTable,
  type PartitionedTableEntry,
  type PartitionedTableName,
  QueueName,
  type Redis,
  type RetentionPolicyRecord,
  RetentionRules,
  type TenantRetentionPolicyRecord,
  type TenantRunway,
  type UserId,
  Worker,
} from "../import.js";

// What `cold-restore` carries. A closed shape rather than the job's `unknown`, checked
// at the one place the payload crosses from the queue into typed code.
interface RestoreJob {
  readonly table: PartitionedTableName;
  readonly period: string;
  readonly organizationId: OrganizationId | null;
}

// What `tenant-export` carries. The day comes from the request rather than the clock, so
// a retry the next morning writes the objects the job id already claimed.
interface ExportJob {
  readonly organizationId: OrganizationId;
  readonly day: string;
}

// What `tenant-delete` carries. The actor rides along because the job's own principal
// is the system's, and the audit row for a delete has to name who asked for it.
interface PurgeJob {
  readonly organizationId: OrganizationId;
  readonly actorId: UserId;
}

// What `tenant-move` carries: `MoveTenantUseCase`'s request, checked there. The actor
// rides along for the audit row, as on a delete.
interface MoveJob {
  readonly organizationId: OrganizationId;
  readonly toNode: number;
  readonly actorId: UserId;
}

// The consumer whose absence meant `cleanup-daily` registered every boot and never ran,
// accumulating silently. See docs/reference/consumers.md.
export class MaintenanceConsumer {
  // A count of partitions per run, not months of runway: three is the current month and
  // the next two, so two consecutive missed runs survive and the third is an outage.
  private static readonly MONTHS_PER_RUN = 3;

  // Below this, say so — and **before** ensuring, never after. `MONTHS_PER_RUN` always
  // leaves two months ahead, so a check after it could never fire.
  private static readonly MIN_MONTHS_AHEAD = 2;

  // Tenants read per page from the catalog. The runway is per tenant now, so this loop
  // is tenants x three tables of DDL a month — paced, never held in one transaction.
  private static readonly TENANT_PAGE = 200;

  // Pre-seeded tenants kept on node 0 — `PF.3`. Twenty is 320 empty partitions, and
  // what signups between two five-minute top-ups can take before one pays for DDL.
  private static readonly SPARE_TENANTS = 20;

  // Days a deleted tenant's objects stay. The delete is recoverable for that long and
  // not a minute more, which is the whole reason cold storage is not cascaded.
  private static readonly DELETED_TENANT_DAYS = 30;

  // How long BullMQ holds this queue's lock without a renewal. Its own default is 30 s,
  // which is a number for short jobs; a runway pass is minutes of paced DDL.
  private static readonly LOCK_DURATION_MS = 300_000;

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
    private readonly concurrency: number,
  ) {}

  public start(): Worker {
    const worker = new Worker(
      QueueName.MAINTENANCE,
      async (job: Job) => this.handle(job),
      // Serial by default: these jobs take table-level locks and can deadlock on the
      // same partition.
      {
        connection: this.connection,
        concurrency: this.concurrency,
        // Five minutes, not BullMQ's 30 s. `partitions-boot` logs nothing for its first
        // half-minute at 78 tenants, so the lock expired, the job was re-delivered and
        // ──
        // ran a second time. Idempotent, so it was waste rather than damage — but the
        // default is sized for short jobs and these are the opposite.
        lockDuration: MaintenanceConsumer.LOCK_DURATION_MS,
      },
    );

    worker.on("failed", (job, error) => {
      // Two lines, and they answer different questions. This one is the countable
      // signal: one `event_code`, so queue health is a rate rather than a grep.
      this.container.logger.emit("queue.job.failed", {
        queue: QueueName.MAINTENANCE,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });

      // And this one is the diagnosis — normalised code, cause and stack, at the level
      // the error catalog decides.
      this.container.logger.failure(error, {
        queue: QueueName.MAINTENANCE,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });
    });

    worker.on("completed", (job) => {
      this.container.logger.emit("queue.job.completed", {
        queue: QueueName.MAINTENANCE,
        jobId: job.id ?? "unknown",
        durationMs: Math.max(0, (job.finishedOn ?? 0) - (job.processedOn ?? 0)),
      });
    });

    worker.on("stalled", (jobId) => {
      this.container.logger.emit("queue.job.stalled", { queue: QueueName.MAINTENANCE, jobId });
    });

    return worker;
  }

  // An unknown job name throws rather than succeeding quietly. Public, because this and
  // not `start()` is the unit of work — a private handler no test can reach.
  public async handle(job: Job): Promise<void> {
    switch (job.name) {
      case "cleanup":
        return this.cleanup();
      case "partitions":
        return this.partitions();
      case "retention":
        return this.retention();
      case "orphans":
        return this.orphans();
      case "spares":
        return this.spares();
      case "cold-restore":
        return this.restore(job.data as RestoreJob);
      case "tenant-export":
        return this.export(job.data as ExportJob);
      case "tenant-delete":
        return this.purge(job.data as PurgeJob);
      case "tenant-move":
        return this.relocate(job.data as MoveJob);
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  }

  // One tenant-month per object, into a scratch table — `17.4`'s rule, and the one
  // case where attaching is right is below.
  private async restore(data: RestoreJob): Promise<void> {
    const table = data.table;
    const period = new Date(`${data.period}T00:00:00.000Z`);
    const entries = await this.container.partitionArchive.entriesFor(
      table,
      data.period,
      data.organizationId ?? undefined,
    );

    // The hot window, from the row if there is one and the allowlist if not — the same
    // resolution `prune()` does, because the two have to agree about what "hot" means.
    const policy = await this.container.retentionPolicies.findBy("postgres", table);
    const months = policy?.hotMonths ?? PartitionedTable.byName(table).retentionMonths;
    const now = this.container.clock.now();
    const cutoff =
      months === null
        ? null
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));

    // Inside the window, the retention pass will not argue with it. Outside, the
    // scratch table stays as evidence — nothing sweeps it, on purpose.
    const inWindow = cutoff === null || period.getTime() >= cutoff.getTime();

    for (const entry of entries) {
      // Placed per entry, not per job: the index is catalog and the scratch table and
      // its ATTACH are the tenant's, so unplaced they were written to node 0.
      const restored = await withShard(this.container, entry.organizationId, async () => {
        const outcome = await this.container.partitionArchive.restore(
          table,
          period,
          entry.organizationId,
        );

        if (inWindow) {
          await this.container.maintenance.attachMonthlyPartition(
            table,
            PartitionedTable.byName(table).tenantKey ? entry.organizationId : null,
            period,
            outcome.scratchTable,
          );
        }

        return outcome;
      });

      this.container.logger.emit("cold.partition.restored", {
        table,
        period: restored.period,
        organizationId: entry.organizationId,
        rows: restored.rowCount,
        attached: inWindow,
      });
    }
  }

  // One object per tenant-owned table, plus the catalog, plus a manifest — live rows,
  // so an export never takes the tenant's data offline.
  private async export(data: ExportJob): Promise<void> {
    // Live rows, so this reads the tenant's own tables. Unplaced it read node 0 and
    // wrote a manifest saying a tenant elsewhere had nothing.
    const exported = await withShard(this.container, data.organizationId, () =>
      this.container.partitionArchive.exportTenant(
        data.organizationId,
        new Date(`${data.day}T00:00:00.000Z`),
      ),
    );

    // One line per export, not one per object: nine lines a run would be nine lines
    // saying the same thing, and the counts are what an operator reads.
    this.container.logger.emit("cold.tenant.exported", {
      organizationId: data.organizationId,
      objects: exported.objects.length,
      rows: exported.objects.reduce((total, object) => total + object.rowCount, 0),
      bytes: exported.objects.reduce((total, object) => total + object.bytes, 0),
    });
  }

  // `19.20`: this was the request path, and for a large tenant it is minutes of
  // streaming to S3 on a pooled connection. It is also the only way to place it right.
  private async purge(data: PurgeJob): Promise<void> {
    // **Placed on the tenant's node, not the admin's.** `shardMiddleware` keys on the
    // actor's organization, so in a request this dropped partitions on the wrong node.
    const purged = await withShard(this.container, data.organizationId, () =>
      this.container.platformAdmin.purgeOrganization.execute(data),
    );

    this.container.logger.emit("tenant.purge.completed", {
      organizationId: data.organizationId,
      archived: purged.archived,
      partitions: purged.partitions,
      outboxRows: purged.outboxRows,
    });
  }

  // **Placed on nothing.** A move is the one job that is not on one node, and every
  // call inside it names the node it means — see relocate-tenant.use-case.ts.
  private async relocate(data: MoveJob): Promise<void> {
    const moved = await this.container.platformAdmin.relocateTenant.execute(data);

    this.container.logger.emit("tenant.move.completed", {
      organizationId: data.organizationId,
      fromNode: moved.fromNode,
      toNode: moved.toNode,
      rows: moved.rows,
    });
  }

  // Silent when the pool was full, which is every run but the ones after a burst.
  private async spares(): Promise<void> {
    const created = await this.container.maintenance.topUpSpareTenants(
      MaintenanceConsumer.SPARE_TENANTS,
    );
    if (created === 0) return;

    this.container.logger.emit("tenant.spares.replenished", {
      created,
      target: MaintenanceConsumer.SPARE_TENANTS,
    });
  }

  // `24.1` moved this guarantee out of the database and into a job. Silence is the
  // healthy answer; a line here is a tenant delete that did not finish.
  private async orphans(): Promise<void> {
    await this.container.eachShard(async (node) => {
      const orphaned = await this.container.maintenance.orphanedTenants();
      if (orphaned.length === 0) return;

      // The ids, not just the count: with no foreign key left this is the only place a
      // leaked tenant is named, and a number alone cannot be chased.
      this.container.logger.emit("maintenance.orphans.found", {
        node,
        tenants: orphaned.length,
        organizationIds: orphaned.join(","),
      });
    });
  }

  private async cleanup(): Promise<void> {
    const now = this.container.clock.now();
    const outcome = await this.container.maintenance.sweepExpired(now);
    // A trial past its date already grants nothing; this removes the row and audits it.
    const expired = await this.container.platformAdmin.expireAdjustments.execute(
      SystemPrincipal.platform(),
      now,
    );
    const lapsed = await this.container.overrides.expire.execute(SystemPrincipal.platform(), now);

    this.container.logger.emit("maintenance.sweep.completed", {
      sessions: outcome.sessions,
      verifications: outcome.verifications,
      invitations: outcome.invitations,
      adjustments: expired.adjustments,
      overrides: lapsed.overrides,
    });

    // Here rather than on a schedule of its own: a grace period is days long, and one
    // nightly pass is all the precision it has ever had.
    const reclaimed = await this.container.platformAdmin.reclaimMoveSources.execute();
    if (reclaimed.tenants > 0) this.container.logger.emit("tenant.source.reclaimed", reclaimed);
  }

  // Every month-partitioned table from the allowlist, on every node: a partition is
  // physical, so the runway is per node and so is the month that leaves for cold storage.
  private async partitions(): Promise<void> {
    // One query for the whole run rather than one per table or per node. An absent row
    // is the code default, so this map is usually empty and the allowlist answers all.
    const rows = await this.container.retentionPolicies.forPostgres();

    await this.container.eachShard(async (node) => {
      for (const entry of PartitionedTable.MONTH_PARTITIONED) {
        await this.ensure(entry, node);
        await this.prune(entry.name, rows.get(entry.name), node);
      }
    });
  }

  // The daily converger. Neither store is written by a save alone: the call after the
  // commit can fail, and a rule deleted by hand in a console is drift nothing else sees.
  private async retention(): Promise<void> {
    const rows = await this.container.retentionPolicies.all();

    await this.convergeLifecycle(rows);
    await this.convergeClickHouse(rows);
    await this.expireArchiveRows(rows);
    await this.sweepDeletedTenants();
  }

  private async convergeLifecycle(rows: readonly RetentionPolicyRecord[]): Promise<void> {
    const expected = RetentionRules.lifecycleFor(rows, this.container.storagePolicy.coldTier());
    const actual = await this.container.storagePolicy.lifecycle();
    if (RetentionRules.lifecycleMatches(expected, actual)) return;

    // Drift first, then the repair. A lone `applied` cannot tell "the reconcile is
    // doing its job" from "somebody edited the bucket by hand last night".
    this.container.logger.emit("retention.lifecycle.drifted", {
      expected: MaintenanceConsumer.serialise(expected),
      actual: MaintenanceConsumer.serialise(actual),
    });

    await this.container.storagePolicy.applyLifecycle(expected);
    this.container.logger.emit("retention.lifecycle.applied", { rules: expected.length });
  }

  // Compared before it is written, because `MODIFY TTL` materialises on every existing
  // part — on a years-deep table that is a rewrite, and a daily one would never finish.
  private async convergeClickHouse(rows: readonly RetentionPolicyRecord[]): Promise<void> {
    if (!this.container.hasProjector) return;

    // Both tables, composed by the same function the screen and the save use: three
    // callers composing the same string by hand is three places for it to drift.
    const expression = RetentionRules.clickhouseTtlFrom(
      rows,
      await this.container.projectionPolicies.all(),
    );

    if ((await this.container.projector.retention()) === expression) return;

    await this.container.projector.applyRetention(expression);
    this.container.logger.emit("analytics.retention.applied", { expression });
  }

  // A row pointing at an object the bucket already expired is a `NotFoundError` on the
  // archived read. Deleted after the rule that removed the object, never before.
  private async expireArchiveRows(rows: readonly RetentionPolicyRecord[]): Promise<void> {
    const now = this.container.clock.now();

    for (const row of rows) {
      if (row.store !== "postgres" || row.coldMonths === null) continue;
      if (!MaintenanceConsumer.isPartitioned(row.tableName)) continue;

      const cutoff = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (row.hotMonths + row.coldMonths), 1),
      );

      const expired = await this.container.partitionArchive.forget(row.tableName, cutoff);
      if (expired === 0) continue;

      this.container.logger.emit("retention.rows.expired", {
        table: row.tableName,
        rows: expired,
      });
    }
  }

  // Postgres forgot these tenants when their row was deleted; the bucket has not. The
  // thirty days are the recovery window, and this is what ends it.
  private async sweepDeletedTenants(): Promise<void> {
    const now = this.container.clock.now();
    const before = new Date(
      now.getTime() - MaintenanceConsumer.DELETED_TENANT_DAYS * 24 * 60 * 60 * 1000,
    );

    const swept = await this.container.partitionArchive.sweepDeleted(before);
    if (swept.objects === 0) return;

    this.container.logger.emit("cold.objects.swept", { reason: "tenant_deleted", ...swept });
  }

  // The closed union, checked rather than cast: a row naming a table the allowlist no
  // longer has must not reach a method that inlines the name into DDL.
  private static isPartitioned(table: string): table is PartitionedTableName {
    return (PartitionedTable.NAMES as readonly string[]).includes(table);
  }

  // The comparison's own spelling, transitions included: a drift line that left them out
  // would print two identical strings for a bucket that lost its colder class.
  private static serialise(rules: Parameters<typeof RetentionRules.lifecycleMatches>[0]): string {
    return [...rules]
      .sort((left, right) => left.prefix.localeCompare(right.prefix))
      .map((rule) => RetentionRules.describe(rule))
      .join("|");
  }

  // The runway, walked per tenant. That product is what bounds how many tenants a node
  // carries.
  private async ensure(
    entry: PartitionedTableEntry & { name: PartitionedTableName },
    node: number,
  ) {
    if (!entry.tenantKey) {
      await this.partitionsFor(entry.name, null);
      return;
    }

    let after: OrganizationId | null = null;

    for (;;) {
      // This node's tenants, not every tenant: a tenant's partition exists on the one
      // node holding its rows, and ensuring it everywhere is the shard count in DDL.
      const page = await this.container.organizations.page(
        after,
        MaintenanceConsumer.TENANT_PAGE,
        node,
      );
      if (page.length === 0) break;

      // One read and one transaction for the page — `PF.5`. The lines are still one per
      // tenant, so `partition.runway.low` still names the tenant that was short.
      const runways = await this.container.maintenance.ensureMonthlyPartitionsFor(
        entry.name,
        page,
        this.container.clock.now(),
        MaintenanceConsumer.MONTHS_PER_RUN,
      );
      for (const runway of runways) this.report(entry.name, runway);

      after = page[page.length - 1] ?? null;
      if (page.length < MaintenanceConsumer.TENANT_PAGE) break;
    }
  }

  // One table, one tenant. A bounded unit of DDL, so a month's worth is a slow trickle
  // rather than one lock storm on the first of the month.
  private async partitionsFor(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
  ): Promise<void> {
    const now = this.container.clock.now();

    // Read *before* ensuring: this run is about to fix the runway, so afterwards there
    // is nothing to report. That it had to is what the operator needs to know.
    const monthsAhead = await this.container.maintenance.monthlyPartitionsAfter(
      table,
      organizationId,
      now,
    );
    if (monthsAhead < MaintenanceConsumer.MIN_MONTHS_AHEAD) {
      this.container.logger.emit("partition.runway.low", {
        table,
        organizationId: organizationId ?? "",
        monthsAhead,
      });
    }

    const created = await this.container.maintenance.ensureMonthlyPartitions(
      table,
      organizationId,
      now,
      MaintenanceConsumer.MONTHS_PER_RUN,
    );

    this.ensured(table, organizationId, created.length);
  }

  private report(table: PartitionedTableName, runway: TenantRunway): void {
    if (runway.monthsAhead < MaintenanceConsumer.MIN_MONTHS_AHEAD) {
      this.container.logger.emit("partition.runway.low", {
        table,
        organizationId: runway.organizationId,
        monthsAhead: runway.monthsAhead,
      });
    }

    this.ensured(table, runway.organizationId, runway.created.length);
  }

  // One line per table per tenant, and both are fields rather than part of the code:
  // the event catalog is the cardinality budget for the `event_code` label.
  private ensured(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
    created: number,
  ): void {
    this.container.logger.emit("maintenance.partitions.ensured", {
      table,
      organizationId: organizationId ?? "",
      created,
      months: MaintenanceConsumer.MONTHS_PER_RUN,
    });
  }

  private async outboxIsBehind(cutoff: Date): Promise<boolean> {
    const oldest = await this.container.outbox.oldestPendingAt();
    return oldest !== null && oldest < cutoff;
  }

  // Archive, then drop — never one without the other. Retention stops meaning deletion
  // here: every month leaves for cold storage and is dropped behind a verified object.
  private async prune(
    table: PartitionedTableName,
    policy: RetentionPolicyRecord | undefined,
    node: number,
  ): Promise<void> {
    // The row, then the allowlist. An absent row **is** the code default, which is what
    // makes an empty `retention_policy` behave exactly as the deploy before it did.
    const months = policy?.hotMonths ?? PartitionedTable.byName(table).retentionMonths;
    if (months === null) return;

    // Before the months are listed, so one a cut-off run left detached is listed again.
    for (const partition of await this.container.partitionArchive.recover(table)) {
      this.container.logger.emit("cold.partition.recovered", { table, partition });
    }

    const now = this.container.clock.now();
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));

    // Only the outbox has a notion of "not yet handled", and a stuck event must never be
    // archived out from under the drain. One table's guard, never every table's.
    if (table === PartitionedTable.OUTBOX_EVENT && (await this.outboxIsBehind(cutoff))) return;

    // Overrides make a table's cutoff differ per tenant, so the pass walks them. Read
    // **before** the mode branch: `drop` destroys a month, and an override cannot undo it.
    const overrides = await this.container.tenantRetentionPolicies.forTable(table);
    const mode = policy?.coldMode ?? "archive";

    if (overrides.size > 0) {
      await this.pruneByTenant(table, months, overrides, node, mode);
      return;
    }

    // `drop` destroys the month rather than archiving it, which is a table of transport
    // rows deciding it is not worth the bytes. The outbox guard above still applies.
    if (mode === "drop") {
      for (const partition of await this.container.maintenance.dropMonthlyPartitionsBefore(
        table,
        null,
        cutoff,
      )) {
        this.container.logger.emit("maintenance.partition.dropped", { table, partition });
      }
      return;
    }

    for (const period of await this.periodsBefore(table, cutoff)) {
      await this.archivePeriod(table, period);
    }
  }

  // `override ?? retention_policy row ?? allowlist`, resolved per tenant. The default
  // months are already resolved by the caller, which is the middle two of the three.
  private async pruneByTenant(
    table: PartitionedTableName,
    defaultMonths: number,
    overrides: ReadonlyMap<OrganizationId, TenantRetentionPolicyRecord>,
    node: number,
    mode: ColdMode,
  ): Promise<void> {
    const now = this.container.clock.now();
    let after: OrganizationId | null = null;

    for (;;) {
      const page = await this.container.organizations.page(
        after,
        MaintenanceConsumer.TENANT_PAGE,
        node,
      );
      if (page.length === 0) break;

      for (const organizationId of page) {
        const months = overrides.get(organizationId)?.hotMonths ?? defaultMonths;
        const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));

        if (mode === "drop") {
          for (const partition of await this.container.maintenance.dropMonthlyPartitionsBefore(
            table,
            organizationId,
            cutoff,
          )) {
            this.container.logger.emit("maintenance.partition.dropped", { table, partition });
          }
          continue;
        }

        for (const period of await this.periodsBefore(table, cutoff, organizationId)) {
          await this.archivePeriod(table, period, organizationId);
        }
      }

      after = page[page.length - 1] ?? null;
      if (page.length < MaintenanceConsumer.TENANT_PAGE) break;
    }
  }

  // Distinct months, oldest first, across every tenant. The read is the same one the
  // retention preview makes, so the screen and the job cannot disagree about what exists.
  private async periodsBefore(
    table: PartitionedTableName,
    cutoff: Date,
    organizationId?: OrganizationId,
  ): Promise<readonly Date[]> {
    const estimates = await this.container.maintenance.partitionsBefore(
      table,
      cutoff,
      organizationId,
    );
    const periods = new Map<number, Date>();

    for (const estimate of estimates) periods.set(estimate.period.getTime(), estimate.period);

    return [...periods.values()].sort((a, b) => a.getTime() - b.getTime());
  }

  // One table-month. A failure here is logged and the loop continues: one month whose
  // upload failed must not stop the months after it, and nothing was dropped.
  private async archivePeriod(
    table: PartitionedTableName,
    period: Date,
    organizationId?: OrganizationId,
  ): Promise<void> {
    try {
      const archived = await this.container.partitionArchive.archive(table, period, organizationId);
      const rows = archived.objects.reduce((total, object) => total + object.rowCount, 0);

      // One line per table-month, not one per tenant object: a month with five thousand
      // tenants would otherwise be five thousand lines.
      this.container.logger.emit("maintenance.partition.archived", {
        table,
        period: archived.period,
        objects: archived.objects.length,
        rows,
      });

      for (const partition of archived.dropped) {
        this.container.logger.emit("maintenance.partition.dropped", { table, partition });
      }

      await this.stampProjected(table, period, archived);
    } catch (error: unknown) {
      this.container.logger.failure(error, { table, period: period.toISOString() });
    }
  }

  // Only the audit trail reaches ClickHouse, so only its months can have a hole — and a
  // month is archived and dropped either way, so a forgotten switch costs a known gap.
  private async stampProjected(
    table: PartitionedTableName,
    period: Date,
    archived: ArchivedPartition,
  ): Promise<void> {
    if (table !== PartitionedTable.ACTIVITY_LOG || archived.objects.length === 0) return;

    // Paused counts as disabled here, and asking for a checkpoint while paused is a
    // query whose answer cannot have moved since the pause.
    const paused =
      this.container.hasProjector && !(await this.container.platformPolicy.get()).projectionEnabled;

    if (!this.container.hasProjector || paused) {
      this.container.logger.emit("analytics.projection.gap", {
        period: archived.period,
        reason: "disabled",
      });
      return;
    }

    // Strictly after the month, because a checkpoint inside it has projected part of the
    // month and stamping that row would claim the whole of it.
    const end = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
    let behind = false;

    for (const object of archived.objects) {
      const checkpoint = await this.container.projector.checkpoint(object.organizationId);
      const at = checkpoint.lastOccurredAt;

      if (at === null || at.getTime() < end.getTime()) {
        behind = true;
        continue;
      }

      await this.container.partitionArchive.markProjected(table, period, object.organizationId);
    }

    if (behind) {
      this.container.logger.emit("analytics.projection.gap", {
        period: archived.period,
        reason: "behind",
      });
    }
  }
}
