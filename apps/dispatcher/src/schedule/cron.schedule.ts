import type { DispatchedMessage } from "../primitive/index.js";

interface Entry {
  readonly queue: string;
  readonly name: string;
  readonly attempts: number;
}

// One trigger, hourly at minute 13, so it never lands on the hour with everyone else's crons.
// One rather than three because the free plan allows five triggers per account, not per Worker.
const HOURLY = "13 * * * *";

// Hourly at most, so Neon's compute can suspend between ticks: the outbox is otherwise
// drained by a job queued after the commit that wrote it.
const EVERY_HOUR: readonly Entry[] = Object.freeze([
  { queue: "event", name: "drain", attempts: 3 },
  { queue: "maintenance", name: "spares", attempts: 3 },
  // Scans: fail the stale ones, then queue the projects whose schedule came due.
  { queue: "maintenance", name: "scan-sweep", attempts: 3 },
  { queue: "maintenance", name: "scan-schedule", attempts: 3 },
]);

// Added on the tick in the given UTC hour: maintenance at 03 and the digest at 07, as the
// BullMQ schedules ran them.
const AT_HOUR: Readonly<Record<number, readonly Entry[]>> = Object.freeze({
  3: [
    { queue: "maintenance", name: "partitions", attempts: 5 },
    { queue: "maintenance", name: "cleanup", attempts: 5 },
    { queue: "maintenance", name: "orphans", attempts: 3 },
    { queue: "maintenance", name: "retention", attempts: 3 },
  ],
  7: [{ queue: "notification", name: "digest-fanout", attempts: 3 }],
});

// What the Cron Trigger enqueues. `wrangler.toml` lists the same expression; a spec fails
// if the two disagree.
export class CronSchedule {
  private constructor() {}

  public static readonly CRONS: readonly string[] = Object.freeze([HOURLY]);

  // The id carries the tick's time, so a trigger Cloudflare fires twice enqueues
  // duplicates the web app can recognise rather than two unrelated jobs.
  public static jobsFor(cron: string, at: Date): DispatchedMessage[] {
    if (cron !== HOURLY) return [];
    const tick = at.toISOString().slice(0, 13).replace(/[-:T]/g, "");
    return [...EVERY_HOUR, ...(AT_HOUR[at.getUTCHours()] ?? [])].map((entry) => ({
      queue: entry.queue,
      name: entry.name,
      id: `${entry.name}_${tick}`,
      data: {},
      maxAttempts: entry.attempts,
    }));
  }
}
