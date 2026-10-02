import type { DispatchedMessage } from "../primitive/index.js";

interface Entry {
  readonly queue: string;
  readonly name: string;
  readonly attempts: number;
}

// Hourly at minute 13, so it never lands on the hour with everyone else's crons.
const HOURLY = "13 * * * *";
// Maintenance at 03:00 UTC and the digest at 07:00 UTC, as the BullMQ schedules ran them.
const NIGHTLY = "0 3 * * *";
const MORNING = "0 7 * * *";

// Hourly at most, so Neon's compute can suspend between ticks: the outbox is otherwise
// drained by a job queued after the commit that wrote it.
const TABLE: Readonly<Record<string, readonly Entry[]>> = Object.freeze({
  [HOURLY]: [
    { queue: "event", name: "drain", attempts: 3 },
    { queue: "maintenance", name: "spares", attempts: 3 },
  ],
  [NIGHTLY]: [
    { queue: "maintenance", name: "partitions", attempts: 5 },
    { queue: "maintenance", name: "cleanup", attempts: 5 },
    { queue: "maintenance", name: "orphans", attempts: 3 },
    { queue: "maintenance", name: "retention", attempts: 3 },
  ],
  [MORNING]: [{ queue: "notification", name: "digest-fanout", attempts: 3 }],
});

// What each Cron Trigger enqueues. `wrangler.toml` lists the same three expressions;
// a spec fails if the two disagree.
export class CronSchedule {
  private constructor() {}

  public static readonly CRONS: readonly string[] = Object.freeze(Object.keys(TABLE));

  // The id carries the tick's time, so a trigger Cloudflare fires twice enqueues
  // duplicates the web app can recognise rather than two unrelated jobs.
  public static jobsFor(cron: string, at: Date): DispatchedMessage[] {
    const tick = at.toISOString().slice(0, 13).replace(/[-:T]/g, "");
    return (TABLE[cron] ?? []).map((entry) => ({
      queue: entry.queue,
      name: entry.name,
      id: `${entry.name}_${tick}`,
      data: {},
      maxAttempts: entry.attempts,
    }));
  }
}
