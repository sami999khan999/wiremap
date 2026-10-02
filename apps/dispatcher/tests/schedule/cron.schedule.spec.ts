import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CronSchedule } from "../../src/schedule/index.js";

describe("CronSchedule", () => {
  // A cron in wrangler.toml with no entry here fires and enqueues nothing, silently.
  it("lists exactly the crons wrangler.toml declares", () => {
    const toml = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../wrangler.toml"),
      "utf8",
    );
    const declared = /crons\s*=\s*\[([^\]]*)\]/
      .exec(toml)?.[1]
      ?.match(/"([^"]+)"/g)
      ?.map((cron) => cron.slice(1, -1));

    expect([...(declared ?? [])].sort()).toEqual([...CronSchedule.CRONS].sort());
  });

  it("enqueues the outbox backstop hourly, never more often", () => {
    const hourly = CronSchedule.jobsFor("13 * * * *", new Date("2026-10-03T05:13:00Z"));

    expect(hourly.map((job) => `${job.queue}/${job.name}`)).toContain("event/drain");
    expect(hourly.every((job) => job.id.endsWith("_2026100305"))).toBe(true);
  });

  it("runs partitions nightly, since no worker boots to run it once", () => {
    const nightly = CronSchedule.jobsFor("0 3 * * *", new Date("2026-10-03T03:00:00Z"));

    expect(nightly.map((job) => job.name)).toEqual([
      "partitions",
      "cleanup",
      "orphans",
      "retention",
    ]);
  });

  it("enqueues nothing for a cron it does not know", () => {
    expect(CronSchedule.jobsFor("* * * * *", new Date())).toEqual([]);
  });
});
