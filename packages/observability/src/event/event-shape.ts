import type { EventCode } from "../catalog/index.js";

// What a log line may carry. Same value types as `ErrorContext`, for the same
// reason: a field is something you filter on, never a sentence you read.
export type LogValue = string | number | boolean;
export type LogFields = Readonly<Record<string, LogValue>>;

// One entry per code, type-only. Declaring the fields is the point: a token cannot be
// logged unless somebody wrote a field for it here, where a reviewer sees it.
export interface EventShape {
  readonly "process.started": { readonly service: string; readonly consumers?: number };
  readonly "process.stopping": { readonly service: string; readonly signal: string };
  readonly "process.stopped": { readonly service: string; readonly durationMs: number };

  readonly "http.request.completed": {
    readonly path: string;
    readonly status: number;
    readonly durationMs: number;
  };
  readonly "http.request.failed": {
    readonly path: string;
    readonly status: number;
    readonly durationMs: number;
  };

  readonly "queue.job.completed": {
    readonly queue: string;
    readonly jobId: string;
    readonly durationMs: number;
  };
  readonly "queue.job.failed": {
    readonly queue: string;
    readonly jobId: string;
    readonly attempt: number;
  };
  readonly "queue.job.stalled": { readonly queue: string; readonly jobId: string };
  readonly "queue.schedule.registered": { readonly queue: string; readonly jobId: string };

  readonly "database.pool.saturated": {
    readonly waiting: number;
    readonly total: number;
    readonly max: number;
    // How long this episode has been going, not how long the process has been up: the
    // counter resets the moment nobody is waiting.
    readonly forMs: number;
  };
  // The driver's own text. There is no code to normalise against — this is a socket that
  // died, not a query that failed.
  readonly "database.pool.error": { readonly message: string };
  readonly "worker.pool.oversubscribed": {
    readonly concurrency: number;
    readonly poolMax: number;
  };

  readonly "maintenance.sweep.completed": {
    readonly sessions: number;
    readonly verifications: number;
    readonly invitations: number;
    // Entitlement adjustments past their expiry. Already ignored by resolution; this is
    // the count the sweep removed and audited.
    readonly adjustments: number;
    // Per-person grants past their expiry, removed and audited the same way.
    readonly overrides: number;
  };
  readonly "maintenance.partitions.ensured": {
    readonly table: string;
    // Empty for the one table with no tenant level — `LogValue` admits no null. In the
    // body, never a label: one stream per tenant makes a log platform unusable.
    readonly organizationId: string;
    readonly created: number;
    // A count of partitions the run ensured, starting at the current month — not the
    // runway, which is one less. Named for what it is after the two drifted apart.
    readonly months: number;
  };
  readonly "maintenance.partition.archived": {
    readonly table: string;
    readonly period: string;
    // Objects written, which is tenants with rows in that month — not tenants, and not
    // partitions: an empty tenant-month is dropped and writes none.
    readonly objects: number;
    readonly rows: number;
  };
  readonly "maintenance.partition.dropped": { readonly table: string; readonly partition: string };
  readonly "cold.partition.recovered": { readonly table: string; readonly partition: string };
  readonly "partition.runway.low": {
    readonly table: string;
    // Which tenant ran out, empty for the table that has no tenant level. Body, not label.
    readonly organizationId: string;
    // Months strictly after the current one. Zero means the next insert past month end
    // fails, and for `activity_log` that is every write in the system.
    readonly monthsAhead: number;
  };
  readonly "retention.lifecycle.applied": {
    // Rules written, not tables: an expired-but-unset table contributes no rule, and a
    // count of tables would read as though it did.
    readonly rules: number;
  };
  readonly "retention.lifecycle.drifted": {
    // Both sides, serialised. The pair is the diff, and a line carrying only one of
    // them is a line an operator has to go and look something up to read.
    readonly expected: string;
    readonly actual: string;
  };
  readonly "retention.rows.expired": {
    readonly table: string;
    readonly rows: number;
  };
  readonly "cold.objects.swept": {
    // Why they went, so a sweep for a deleted tenant is distinguishable from the
    // bucket expiring a month on its own.
    readonly reason: string;
    readonly organizations: number;
    readonly objects: number;
  };
  readonly "shard.resolution.failed": {
    readonly key: string;
  };
  readonly "shard.assignment.created": {
    readonly key: string;
    readonly node: number;
  };
  readonly "cold.tenant.exported": {
    readonly organizationId: string;
    readonly objects: number;
    readonly rows: number;
    readonly bytes: number;
  };
  // `outboxRows` is here because `24.1` moved that sweep out of the database: a zero
  // when the tenant had events is the shape of the sweep silently not running.
  readonly "tenant.purge.completed": {
    readonly organizationId: string;
    readonly archived: number;
    readonly partitions: number;
    readonly outboxRows: number;
  };
  readonly "tenant.spares.replenished": {
    readonly created: number;
    readonly target: number;
  };
  // The ids, not just the count: with no foreign key left, this line is the only place
  // a leaked tenant is named, and a number alone cannot be chased.
  readonly "maintenance.orphans.found": {
    readonly node: number;
    readonly tenants: number;
    readonly organizationIds: string;
  };
  readonly "cold.partition.restored": {
    readonly table: string;
    readonly period: string;
    readonly organizationId: string;
    readonly rows: number;
    // Where it landed. `false` is the scratch table, which is every restore outside the
    // table's hot window — and the screen says to raise hot months first.
    readonly attached: boolean;
  };
  readonly "dependency.request.failed": {
    readonly dependency: string;
    readonly status: number;
    // Truncated at the call site. The one field here that is read rather than
    // filtered on, because a vendor body is the whole diagnostic.
    readonly detail: string;
  };

  // No recipient: the address is what the failing send was about, and a log line is
  // not where it belongs. The reason is truncated at the call site.
  readonly "email.send.failed": { readonly reason: string };

  // No recipient on any of the three. An address is the highest-cardinality field this
  // system holds and a log platform is not where it belongs.
  readonly "mail.delivery.queued": { readonly template: string; readonly priority: string };
  // The transport's id, or the empty string when it returned none: `LogValue` admits no
  // null, and a missing id is a fact about the server rather than about the message.
  readonly "mail.delivery.sent": { readonly template: string; readonly messageId: string };
  readonly "mail.delivery.failed": { readonly template: string; readonly attempts: number };

  readonly "outbox.drain.completed": { readonly events: number; readonly jobs: number };
  readonly "outbox.drain.lagged": { readonly oldestAgeMs: number };
  readonly "shard.sweep.failed": { readonly node: number };
  readonly "outbox.delivery.failed": { readonly subscriber: string; readonly event: string };

  readonly "notification.digest.completed": {
    readonly organizations: number;
    readonly day: string;
  };

  // No user id and no channel: both are per-person, and a label is not what they would
  // become — but a line body carrying one on every stream open is a retention bill.
  readonly "realtime.stream.opened": { readonly resumed: boolean };
  readonly "realtime.stream.closed": { readonly durationMs: number; readonly frames: number };
  readonly "realtime.stream.drained": { readonly streams: number; readonly durationMs: number };
  readonly "realtime.publish.failed": { readonly event: string };

  readonly "cache.entry.corrupt": { readonly key: string };
  readonly "embedding.request.failed": { readonly model: string; readonly chunks: number };

  readonly "analytics.projection.gap": {
    readonly period: string;
    // `disabled` is no projector at all; `behind` is one that has not caught up to the
    // end of the month. The first is a decision, the second is a backlog.
    readonly reason: string;
  };
}

export type EventFields<C extends EventCode> = EventShape[C];

// The wire format. One of these becomes one line of JSON on stdout.
export interface LogEntry {
  readonly level: string;
  readonly time: string;
  readonly event: EventCode | "error.raised";
  readonly fields: LogFields;
}
