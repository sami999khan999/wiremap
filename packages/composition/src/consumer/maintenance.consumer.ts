import {
  type OrganizationId,
  PartitionedTable,
  type PartitionedTableEntry,
  type PartitionedTableName,
  type ProjectId,
  QueueName,
  RetentionRules,
  type TenantRunway,
  type UserId,
} from "../import.js";
import { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";
import { SystemPrincipal } from "./system-principal.js";

// What `tenant-export` carries. The day comes from the request rather than the clock, so
// a retry the next morning writes the objects the job id already claimed.
interface ExportJob {
  readonly organizationId: OrganizationId;
  readonly day: string;
}

// What `tenant-delete` carries. The actor rides along because the job's own principal
// is the system's, and the audit row for a delete has to name who asked for it.
interface RerenderJob {
  readonly organizationId: OrganizationId;
}

interface ProjectDeleteJob {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
}

interface PurgeJob {
  readonly organizationId: OrganizationId;
  readonly actorId: UserId;
}

// The consumer whose absence meant `cleanup-daily` registered every boot and never ran,
// accumulating silently. See apps/worker/docs/reference/consumers.md.
export class MaintenanceConsumer extends QueueConsumer {
  public readonly queue = QueueName.MAINTENANCE;

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

  // An unknown job name throws rather than succeeding quietly. Public, because this and
  // not `start()` is the unit of work — a private handler no test can reach.
  public async handle(job: QueueJob): Promise<void> {
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
      case "tenant-export":
        return this.export(job.data as ExportJob);
      case "tenant-delete":
        return this.purge(job.data as PurgeJob);
      case "doc-rerender":
        return this.rerender(job.data as RerenderJob);
      case "project-delete":
        return this.projectDelete(job.data as ProjectDeleteJob);
      case "scan-sweep":
        return this.scanSweep();
      case "scan-schedule":
        return this.scanSchedule();
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  }

  // One object per tenant-owned table, plus the catalog, plus a manifest — live rows,
  // so an export never takes the tenant's data offline.
  private async export(data: ExportJob): Promise<void> {
    // Live rows, so this reads the tenant's own tables. Unplaced it read node 0 and
    // wrote a manifest saying a tenant elsewhere had nothing.
    const exported = await this.placed(data.organizationId, () =>
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
    const purged = await this.placed(data.organizationId, () =>
      this.container.platformAdmin.purgeOrganization.execute(data),
    );

    this.container.logger.emit("tenant.purge.completed", {
      organizationId: data.organizationId,
      archived: purged.archived,
      partitions: purged.partitions,
      outboxRows: purged.outboxRows,
    });
  }

  // Queued by `project.remove` after the soft delete; replaying it removes nothing more.
  private async projectDelete(data: ProjectDeleteJob): Promise<void> {
    const purged = await this.container.projects.purge.execute(data);
    this.container.logger.emit("project.purge.completed", {
      organizationId: data.organizationId,
      projectId: data.projectId,
      objects: purged.objects,
    });
  }

  // Node by node: scans are tenant rows, and a dead runner's scan is failed where it lives.
  private async scanSweep(): Promise<void> {
    await this.container.eachShard(async (node) => {
      const swept = await this.container.scans.sweep.execute((organizationId) =>
        SystemPrincipal.forOrganization(organizationId),
      );
      if (swept.length > 0)
        this.container.logger.emit("scan.sweep.failed", { node, scans: swept.length });
    });
  }

  // Projects claim their own slot in the catalog; each scan is then queued on its tenant's node.
  private async scanSchedule(): Promise<void> {
    const due = await this.container.projects.tracking.claimScheduled(new Date());
    for (const project of due) {
      await this.placed(project.organizationId, () =>
        this.container.scans.trigger.execute({ ...project, trigger: "schedule", branch: null }),
      );
    }
  }

  // Off `pnpm doc:rerender`, one job per organization, placed on the tenant's node.
  private async rerender(data: RerenderJob): Promise<void> {
    const pages = await this.placed(data.organizationId, () =>
      this.container.doc.rerender.run(data.organizationId),
    );
    if (pages === 0) return;
    this.container.logger.emit("doc.pages.rerendered", {
      organizationId: data.organizationId,
      pages,
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
  }

  // Every month-partitioned table from the allowlist, on every node: a partition is
  // physical, so the runway is per node. Nothing in lite drops a month.
  private async partitions(): Promise<void> {
    await this.container.eachShard(async (node) => {
      for (const entry of PartitionedTable.MONTH_PARTITIONED) await this.ensure(entry, node);
    });
  }

  // The daily converger: the bucket's export rule, then the end of each deleted tenant's
  // recovery window. A rule deleted by hand in a console is drift nothing else sees.
  private async retention(): Promise<void> {
    await this.convergeLifecycle();
    await this.sweepDeletedTenants();
  }

  private async convergeLifecycle(): Promise<void> {
    if (!this.container.storagePolicy.managesLifecycle) return;
    const expected = RetentionRules.lifecycleFor();
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

  // The comparison's own spelling, so a drift line prints what was compared.
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
}
