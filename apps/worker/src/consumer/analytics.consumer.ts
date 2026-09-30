import { withShard } from "../bootstrap/index.js";
import {
  type ActivityAction,
  type ActivityRecord,
  ActivitySubject,
  type Container,
  type Job,
  type OrganizationId,
  PartitionedTable,
  type ProjectionCheckpoint,
  QueueName,
  type Redis,
  Shard,
  Worker,
} from "../import.js";

// What `cold-reproject` carries. A closed shape rather than the job's `unknown`,
// checked at the one place the payload crosses from the queue into typed code.
interface ReprojectJob {
  readonly period: string;
  readonly organizationId: OrganizationId | null;
}

// What makes ClickHouse derived rather than authoritative: `project` moves the rows and
// `reconcile` notices when it has not. See docs/reference/consumers.md.
export class AnalyticsConsumer {
  // Large enough that ClickHouse merges a few big parts rather than many small ones —
  // see docs/reference/consumers.md.
  private static readonly BATCH_SIZE = 5_000;

  // How far behind the clock the walk stops. `occurred_at` is stamped when a transaction
  // starts, so a slow one commits below a checkpoint that has already passed it.
  private static readonly SETTLE_LAG_MS = 30_000;

  // A ceiling on one job, not on the backlog, and total across tenants: one busy tenant
  // cannot make the run cost tenants x batches.
  private static readonly MAX_BATCHES_PER_RUN = 20;

  // Tenants read per page from the catalog, the same page size the maintenance consumer
  // walks them in.
  private static readonly TENANT_PAGE = 200;

  // Two runs of the schedule: one late run is a slow batch, two is a consumer that has
  // stopped.
  private static readonly LAG_WARNING_MS = 10 * 60 * 1_000;

  // Long enough to catch a consumer that died over a weekend, short enough that the
  // comparison is two cheap aggregates.
  private static readonly RECONCILE_DAYS = 7;

  // The label on every line this file emits, so a second projection does not change the
  // event shape and a dashboard filters on it rather than on the queue name.
  private static readonly PROJECTION = "activity_events";

  // Where the last run stopped. In the cache, because losing it costs one run that starts
  // at the first tenant again; a day, because the schedule fires every five minutes.
  private static readonly CURSOR_KEY = "analytics:project:cursor";
  private static readonly CURSOR_TTL_SECONDS = 24 * 60 * 60;

  // Consecutive tenant failures after which the run stops. The cursor still advances, so
  // a tenant that alone keeps failing is passed on the next run rather than retried first.
  private static readonly FAILURES_BEFORE_STOPPING = 3;

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
    private readonly concurrency: number,
  ) {}

  public start(): Worker {
    const worker = new Worker(
      QueueName.ANALYTICS,
      async (job: Job) => this.handle(job),
      // Serial regardless of what is configured elsewhere: correctness rests on there
      // being one writer, not on the insert being idempotent.
      { connection: this.connection, concurrency: this.concurrency },
    );

    worker.on("failed", (job, error) => {
      // Two lines, and they answer different questions. This one is the countable
      // signal: one `event_code`, so queue health is a rate rather than a grep.
      this.container.logger.emit("queue.job.failed", {
        queue: QueueName.ANALYTICS,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });

      // And this one is the diagnosis — normalised code, cause and stack, at the level
      // the error catalog decides.
      this.container.logger.failure(error, {
        queue: QueueName.ANALYTICS,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });
    });

    worker.on("stalled", (jobId) => {
      this.container.logger.emit("queue.job.stalled", { queue: QueueName.ANALYTICS, jobId });
    });

    return worker;
  }

  public async handle(job: Job): Promise<void> {
    switch (job.name) {
      case "project":
        return this.project();
      case "reconcile":
        return this.reconcile();
      case "cold-reproject":
        return this.reproject(job.data as ReprojectJob);
      default:
        throw new Error(`Unknown analytics job: ${job.name}`);
    }
  }

  // One month out of cold storage and back into the derived store. It owns the
  // projector, which is why this lives here and not on `MaintenanceConsumer`.
  private async reproject(data: ReprojectJob): Promise<void> {
    const period = new Date(`${data.period}T00:00:00.000Z`);
    const entries = await this.container.partitionArchive.entriesFor(
      PartitionedTable.ACTIVITY_LOG,
      data.period,
      data.organizationId ?? undefined,
    );
    const excluding = await this.excluded();

    for (const entry of entries) {
      // A batch at a time, never the month (`CR.16`): a month parsed whole OOMed the worker
      // and blocked the event loop past the other queues' locks.
      let projected = 0;
      for await (const rows of this.container.coldArchive.batches(
        entry,
        AnalyticsConsumer.BATCH_SIZE,
      )) {
        const records = rows
          .map((row) => AnalyticsConsumer.recordOf(row, entry.organizationId))
          .filter((record) => !excluding.includes(record.action as ActivityAction));
        if (records.length > 0) projected += await this.container.projector.project(records);
      }

      // Stamped after the rows land, never before: a stamp on a projection that failed
      // is a gap the partial index can no longer find.
      await this.container.partitionArchive.markProjected(
        PartitionedTable.ACTIVITY_LOG,
        period,
        entry.organizationId,
      );

      this.container.logger.emit("cold.partition.reprojected", {
        period: entry.period,
        organizationId: entry.organizationId,
        rows: projected,
      });
    }
  }

  // The archived line back into the shape the projector takes. `ActivitySubject.of` is
  // the same lift `PgActivityReplayReader` does, which is why it is a shared primitive.
  private static recordOf(
    row: Readonly<Record<string, unknown>>,
    organizationId: OrganizationId,
  ): ActivityRecord {
    const payload = (row.payload ?? {}) as Readonly<Record<string, unknown>>;

    return {
      id: String(row.id),
      organizationId,
      occurredAt: new Date(String(row.occurred_at)),
      actorId: String(row.actor_id) as ActivityRecord["actorId"],
      action: String(row.action),
      subjectId: ActivitySubject.of(payload),
      payload,
    };
  }

  // Per tenant in both stores since `0023`: a walk with no tenant predicate appends every
  // tenant's months into every batch.
  private async project(): Promise<void> {
    // No batches, no lag computation, and **no log line**: 288 lines a day saying
    // "paused" is noise, and the status screen already shows the state.
    const policy = await this.container.platformPolicy.get();
    if (!policy.projectionEnabled) return;

    const startedAt = this.container.clock.now();
    // Once per run, not per tenant: it is one small table and every tenant's walk
    // subtracts the same list.
    const excluding = await this.excluded();

    let projected = 0;
    let batches = 0;
    let lagMs = 0;
    let tenants = 0;
    let skipped = 0;
    let failed = 0;
    let failingInARow = 0;
    let failure: Error | null = null;
    let last: OrganizationId | null = null;

    // From where the last run stopped, wrapping round: first come, first served let one
    // tenant early in id order spend every run's budget before anyone after it (`CR.20`).
    const start = await this.container.cache
      .get<OrganizationId>(AnalyticsConsumer.CURSOR_KEY)
      .catch(() => null);

    for await (const organizationId of this.rotation(start)) {
      if (batches >= AnalyticsConsumer.MAX_BATCHES_PER_RUN) break;
      tenants += 1;
      last = organizationId;

      // Reported and passed over: one tenant in a bad state must not stop a rebuildable
      // store for everyone after it. The first failure still fails the run, below.
      let outcome: Awaited<ReturnType<AnalyticsConsumer["projectTenantOrReport"]>>;
      try {
        outcome = await this.projectTenantOrReport(
          organizationId,
          AnalyticsConsumer.MAX_BATCHES_PER_RUN - batches,
          excluding,
          policy.replicaReadsEnabled,
        );
      } catch (error: unknown) {
        failed += 1;
        failure ??= error instanceof Error ? error : new Error(String(error));
        // Three in a row is the store, not the tenants: an unreachable ClickHouse wrote a
        // failure line for every tenant every five minutes until the run stopped here.
        failingInARow += 1;
        if (failingInARow >= AnalyticsConsumer.FAILURES_BEFORE_STOPPING) break;
        continue;
      }
      failingInARow = 0;
      if (outcome === null) {
        skipped += 1;
        continue;
      }
      projected += outcome.projected;
      batches += outcome.batches;
      // The max over tenants, not the last one's: the run is as far behind as its
      // furthest-behind tenant.
      lagMs = Math.max(lagMs, outcome.lagMs);
    }

    if (last !== null) {
      await this.container.cache
        .set(AnalyticsConsumer.CURSOR_KEY, last, AnalyticsConsumer.CURSOR_TTL_SECONDS)
        .catch(() => undefined);
    }

    const now = this.container.clock.now();
    const lagSeconds = Math.round(lagMs / 1_000);

    this.container.logger.emit("analytics.projection.completed", {
      projection: AnalyticsConsumer.PROJECTION,
      tenants,
      events: projected,
      durationMs: now.getTime() - startedAt.getTime(),
      lagSeconds,
      skipped,
      failed,
      capped: batches >= AnalyticsConsumer.MAX_BATCHES_PER_RUN,
    });

    // `warn`, not `debug`: a projection that throws is already an error line, and one
    // falling quietly behind produces nothing at all.
    if (lagMs > AnalyticsConsumer.LAG_WARNING_MS) {
      this.container.logger.emit("analytics.projection.lagged", {
        projection: AnalyticsConsumer.PROJECTION,
        lagSeconds,
        thresholdSeconds: AnalyticsConsumer.LAG_WARNING_MS / 1_000,
      });
    }

    // After every other tenant has had its turn, so BullMQ still sees the run fail.
    if (failure !== null) throw failure;
  }

  // Every tenant once, starting after `start` and wrapping round to it. Pages from the
  // catalog lazily, so a run that spends its budget early stops reading it too.
  private async *rotation(start: OrganizationId | null): AsyncGenerator<OrganizationId> {
    let after = start;
    for (;;) {
      const page = await this.container.organizations.page(after, AnalyticsConsumer.TENANT_PAGE);
      yield* page;
      if (page.length < AnalyticsConsumer.TENANT_PAGE) break;
      after = page[page.length - 1] ?? null;
    }
    if (start === null) return;

    after = null;
    for (;;) {
      const page = await this.container.organizations.page(after, AnalyticsConsumer.TENANT_PAGE);
      for (const organizationId of page) {
        if (organizationId > start) return;
        yield organizationId;
      }
      if (page.length < AnalyticsConsumer.TENANT_PAGE) return;
      after = page[page.length - 1] ?? null;
    }
  }

  // The actions no longer projected. An absent row is "projected", so this is the
  // rows that say otherwise and usually none.
  private async excluded(): Promise<readonly ActivityAction[]> {
    const rows = await this.container.projectionPolicies.all();
    return rows.filter((row) => !row.projected).map((row) => row.action);
  }

  // Rethrows: BullMQ's retry is driven by rejection. Per tenant, because the checkpoint
  // is — there is no global "where the replay resumes" left to report.
  // ──
  // `null` is a tenant skipped for having no directory row — `23.21`, decided 2026-09-25.
  private async projectTenantOrReport(
    organizationId: OrganizationId,
    budget: number,
    excluding: readonly ActivityAction[],
    replica: boolean,
  ): Promise<{ projected: number; batches: number; lagMs: number } | null> {
    try {
      // Placed *inside* the guard. Outside it a tenant with no `shard_assignments` row
      // threw past this catch, so the run died on `queue.job.failed` and the line a
      // ──
      // projection dashboard filters on was never emitted. Per tenant rather than per
      // node: the read side is routed `activity_log`, the write side one ClickHouse.
      return await withShard(
        this.container,
        organizationId,
        () => this.projectTenant(organizationId, budget, excluding),
        { replica },
      );
    } catch (error: unknown) {
      // Guarded, both: a lookup that threw here replaced the error it follows, and the
      // failure line was never emitted (`CR.44`). Unknown is "not skipped".
      if (await this.skippedUnplaced(organizationId, "project").catch(() => false)) return null;

      // Read after the throw rather than before it, so the failure line names where the
      // destination actually stands rather than where this run hoped to start. Outside
      // ──
      // the shard scope on purpose: the checkpoint is ClickHouse, one for the deployment.
      const checkpoint = await this.container.projector
        .checkpoint(organizationId)
        .catch(() => null);
      this.container.logger.emit("analytics.projection.failed", {
        projection: AnalyticsConsumer.PROJECTION,
        organizationId,
        eventId: checkpoint === null ? "unknown" : (checkpoint.lastId ?? "none"),
      });
      throw error;
    }
  }

  // **Skipped only when the directory has no row**, asked after the throw. Any other
  // failure — the catalog down, a query timing out — still fails the run and retries.
  // ──
  // One tenant in the wrong state must not stop a rebuildable store for everyone else.
  private async skippedUnplaced(organizationId: OrganizationId, job: string): Promise<boolean> {
    const assignment = await this.container.shardAssignments.findByKey(Shard.keyOf(organizationId));
    if (assignment !== null) return false;

    this.container.logger.emit("analytics.tenant.skipped", { organizationId, job });
    return true;
  }

  // One tenant's walk, bounded by what is left of the run's batch budget. The checkpoint
  // advances because rows landed, never because a batch was acknowledged.
  private async projectTenant(
    organizationId: OrganizationId,
    budget: number,
    excluding: readonly ActivityAction[],
  ): Promise<{ projected: number; batches: number; lagMs: number }> {
    const projector = this.container.projector;
    // The settle horizon for this tenant's whole walk, taken once. `occurred_at` is
    // stamped at write and rows commit out of that order. See docs/reference/consumers.md.
    const until = new Date(this.container.clock.now().getTime() - AnalyticsConsumer.SETTLE_LAG_MS);
    let checkpoint = await projector.checkpoint(organizationId);
    let projected = 0;
    let batches = 0;
    let caughtUp = false;

    while (batches < budget) {
      const records = await this.container.activityReplay.since(
        organizationId,
        checkpoint,
        AnalyticsConsumer.BATCH_SIZE,
        excluding,
        until,
      );
      if (records.length === 0) {
        caughtUp = true;
        break;
      }

      projected += await projector.project(records);
      batches += 1;

      const last = records[records.length - 1];
      if (!last) break;
      checkpoint = { lastOccurredAt: last.occurredAt, lastId: last.id };

      // A short batch means caught up: continuing issues one more query to learn what
      // this length already said.
      if (records.length < AnalyticsConsumer.BATCH_SIZE) {
        caughtUp = true;
        break;
      }
    }

    const lagMs = await this.lagMs(organizationId, checkpoint, caughtUp, excluding, until);
    return { projected, batches, lagMs };
  }

  // The age of the oldest row still unprojected, never the age of the newest projected
  // one. See docs/reference/consumers.md for what each of those answers.
  private async lagMs(
    organizationId: OrganizationId,
    checkpoint: ProjectionCheckpoint,
    caughtUp: boolean,
    excluding: readonly ActivityAction[],
    until: Date,
  ): Promise<number> {
    if (caughtUp) return 0;

    // The same exclusion and the same horizon: lag measured over rows this walk was
    // never going to reach is a backlog that never shrinks and an alert that never clears.
    const [oldest] = await this.container.activityReplay.since(
      organizationId,
      checkpoint,
      1,
      excluding,
      until,
    );
    if (!oldest) return 0;
    return this.container.clock.now().getTime() - oldest.occurredAt.getTime();
  }

  // Counts per day on both sides and a diff, with today excluded because a difference in
  // it is timing rather than drift. See docs/reference/consumers.md.
  private async reconcile(): Promise<void> {
    // Paused, so there is nothing to reconcile against: every day in the window would
    // report drift, which is an alert that says only what the switch already says.
    const policy = await this.container.platformPolicy.get();
    if (!policy.projectionEnabled) return;

    const now = this.container.clock.now();
    const excluding = await this.excluded();
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = new Date(to.getTime() - AnalyticsConsumer.RECONCILE_DAYS * 24 * 60 * 60 * 1_000);

    let days = 0;
    let drifted = 0;
    let after: OrganizationId | null = null;

    for (;;) {
      const page = await this.container.organizations.page(after, AnalyticsConsumer.TENANT_PAGE);
      if (page.length === 0) break;

      for (const organizationId of page) {
        const outcome = await withShard(
          this.container,
          organizationId,
          () => this.reconcileTenant(organizationId, from, to, excluding),
          { replica: policy.replicaReadsEnabled },
        ).catch(async (error: unknown) => {
          if (await this.skippedUnplaced(organizationId, "reconcile").catch(() => false))
            return null;
          throw error;
        });
        if (outcome === null) continue;
        days += outcome.days;
        drifted += outcome.drifted;
      }

      after = page[page.length - 1] ?? null;
      if (page.length < AnalyticsConsumer.TENANT_PAGE) break;
    }

    // Emitted whether or not anything drifted. Returning early here made "reconciliation
    // is finding drift" and "the consumer stopped" the same absence on a dashboard.
    this.container.logger.emit("analytics.reconciliation.completed", {
      days,
      drifted,
      durationMs: this.container.clock.now().getTime() - now.getTime(),
    });
  }

  // One tenant's diff, and `excluding` goes to **both** sides: subtracted from one
  // only, every excluded row reads as drift on the run after it was excluded.
  private async reconcileTenant(
    organizationId: OrganizationId,
    from: Date,
    to: Date,
    excluding: readonly ActivityAction[],
  ): Promise<{ days: number; drifted: number }> {
    const [source, derived] = await Promise.all([
      this.container.activityReplay.dailyCounts(organizationId, from, to, excluding),
      this.container.projector.dailyCounts(organizationId, from, to, excluding),
    ]);

    const derivedByDay = new Map(derived.map((count) => [count.day, count.rows]));
    const drift = source
      .map((count) => ({
        day: count.day,
        source: count.rows,
        derived: derivedByDay.get(count.day) ?? 0,
      }))
      .filter((row) => row.source !== row.derived);

    // One line per drifting day, at `error`: every number shown since the first drifting
    // day is wrong, and the replay that fixes it has a deadline.
    for (const row of drift) {
      this.container.logger.emit("analytics.reconciliation.drifted", {
        organizationId,
        source: "hot",
        day: row.day,
        expected: row.source,
        actual: row.derived,
      });
    }

    const cold = await this.reconcileCold(organizationId, excluding);

    return { days: source.length + cold.months, drifted: drift.length + cold.drifted };
  }

  // The cold half. `activity_log`'s hot window is thirteen months and its cold window
  // is years, so the hot diff above sees none of it — this closes that.
  private async reconcileCold(
    organizationId: OrganizationId,
    excluding: readonly ActivityAction[],
  ): Promise<{ months: number; drifted: number }> {
    const months = await this.container.partitionArchive.monthsOf(
      PartitionedTable.ACTIVITY_LOG,
      organizationId,
    );
    // A known gap is not drift. `projected_at` null means this store never received the
    // month, which the Gaps panel already says and a second alert would only repeat.
    const projected = months.filter((entry) => entry.projectedAt !== null);
    if (projected.length === 0) return { months: 0, drifted: 0 };

    const first = projected[0];
    const last = projected.at(-1);
    if (!first || !last) return { months: 0, drifted: 0 };

    // One query per tenant over the whole archived range, not one per month: the
    // second shape is a round trip per month per tenant on a nightly job.
    const derived = await this.container.projector.dailyCounts(
      organizationId,
      new Date(`${first.period}T00:00:00.000Z`),
      AnalyticsConsumer.monthAfter(last.period),
      excluding,
    );

    const byMonth = new Map<string, number>();
    for (const count of derived) {
      const month = `${count.day.slice(0, 7)}-01`;
      byMonth.set(month, (byMonth.get(month) ?? 0) + count.rows);
    }

    let drifted = 0;
    for (const entry of projected) {
      const excluded = excluding.reduce(
        (total, action) => total + (entry.actionCounts[action] ?? 0),
        0,
      );
      const expected = entry.rowCount - excluded;
      const actual = byMonth.get(entry.period) ?? 0;
      if (expected === actual) continue;

      drifted += 1;
      this.container.logger.emit("analytics.reconciliation.drifted", {
        organizationId,
        source: "cold",
        day: entry.period,
        expected,
        actual,
      });
    }

    return { months: projected.length, drifted };
  }

  // The first of the month after the one `period` names. `[from, to)`, which is the
  // half-open window both `dailyCounts` take.
  private static monthAfter(period: string): Date {
    const at = new Date(`${period}T00:00:00.000Z`);
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  }
}
