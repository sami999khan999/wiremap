import type { EventMeta } from "./index.js";

// This catalog is the cardinality budget for the `event_code` label, so codes stay
// coarse: one code carrying a `queue` field, never one code per queue.
export const coreEvents = {
  "process.started": { level: "info" },
  "process.stopping": { level: "info" },
  "process.stopped": { level: "info" },

  // Sampled: the highest-volume line this system emits, and 10 % shows a latency shift.
  // Failures below are never sampled.
  "http.request.completed": { level: "info", sample: 0.1 },
  "http.request.failed": { level: "warn" },

  "queue.job.completed": { level: "debug" },
  "queue.job.failed": { level: "error" },
  "queue.job.stalled": { level: "warn" },
  "queue.schedule.registered": { level: "info" },

  // `saturated` is the pool's own queue, and it is blind to a pooler in front: a wait
  // inside pgBouncer reads as zero here. See docs/scale/pgbouncer.md.
  "database.pool.saturated": { level: "warn" },
  // An idle connection whose socket died — a restarted pooler, a failover. Warn, not
  // error: `pg` opens another, and the alternative to catching it is the process exiting.
  "database.pool.error": { level: "warn" },
  // The sum of what the consumers that actually started will run concurrently, against
  // the pool they share. Once at boot.
  "worker.pool.oversubscribed": { level: "warn" },

  // Do not alert on `ensured.created == 0` — that is the steady state, because the runway
  // is already three months deep. `partition.runway.low` is the signal.
  "maintenance.sweep.completed": { level: "info" },
  "maintenance.partitions.ensured": { level: "info" },
  // Counts what exists, never what the last run created: a run that creates zero is the
  // healthy case and the starved case alike.
  "partition.runway.low": { level: "warn" },

  // `drifted` first, then `applied`: the pair says whether the reconcile is doing its
  // job or repairing a hand edit, and a lone `applied` cannot tell them apart.
  "retention.lifecycle.applied": { level: "info" },
  "retention.lifecycle.drifted": { level: "warn" },
  // Cold storage outliving a deleted tenant is the hole this mechanism created, so
  // this is the line that says it closed. One per run, not one per object.
  "cold.objects.swept": { level: "info" },
  // One per export, not one per object: nine lines a run would be nine lines saying
  // the same thing, and the counts are what an operator reads.
  "cold.tenant.exported": { level: "info" },
  // The delete is a job now (`19.20`), so this is the only line that says it finished.
  // `outboxRows` is on it because `24.1` moved that sweep out of the database.
  "tenant.purge.completed": { level: "info" },
  // The spare pool refilled after signups drew on it. Silent when it was already full.
  "tenant.spares.replenished": { level: "info" },
  // `warn`, not `info`: a non-zero count is a tenant delete that did not finish, and
  // since `24.1` the database will not say so on its own.
  "maintenance.orphans.found": { level: "warn" },
  // The directory has no row for a key. Today every node is zero and guessing would
  // work; after a split it would place a tenant somewhere else entirely.
  "shard.resolution.failed": { level: "error" },
  "shard.assignment.created": { level: "info" },

  // The transport's own reason, which `UnavailableError("smtp")` deliberately does not
  // carry. Without it a bounced invitation is a 200 and nothing else.
  "email.send.failed": { level: "error" },

  // Together these are the delivery record, because there is no delivery table. `queued`
  // and `sent` bracket a message; `failed` fires once, on the last attempt.
  "mail.delivery.queued": { level: "debug" },
  "mail.delivery.sent": { level: "info" },
  "mail.delivery.failed": { level: "error" },

  // `lagged` is the one that matters: a drain that stops running is silent otherwise,
  // because "no events published" and "no events to publish" look identical.
  "outbox.drain.completed": { level: "debug" },
  "outbox.drain.lagged": { level: "warn" },
  // One node failed a cross-tenant pass and the pass went on to the next one.
  "shard.sweep.failed": { level: "warn" },
  "outbox.delivery.failed": { level: "error" },

  "notification.digest.completed": { level: "info" },

  // A pair, not a counter: `opened` minus `closed` is the live stream count, and the
  // duration on `closed` is what says whether a client is reconnecting in a loop.
  "realtime.stream.opened": { level: "debug" },
  "realtime.stream.closed": { level: "debug" },
  // A stopping stream process handed its streams on; `streams` is -1 if it ran out of time.
  "realtime.stream.drained": { level: "info" },
  "realtime.publish.failed": { level: "warn" },

  "cache.entry.corrupt": { level: "warn" },
  "embedding.request.failed": { level: "error" },
} as const satisfies Record<string, EventMeta>;
