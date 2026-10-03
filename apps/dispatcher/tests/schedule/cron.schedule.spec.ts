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

  it("adds the nightly maintenance on the 03 UTC tick and the digest on the 07 one", () => {
    const names = (iso: string) =>
      CronSchedule.jobsFor("13 * * * *", new Date(iso)).map((job) => job.name);

    expect(names("2026-10-03T03:13:00Z")).toEqual(
      expect.arrayContaining(["drain", "partitions", "cleanup", "orphans", "retention"]),
    );
    expect(names("2026-10-03T07:13:00Z")).toContain("digest-fanout");
    expect(names("2026-10-03T05:13:00Z")).not.toContain("partitions");
    expect(names("2026-10-03T05:13:00Z")).not.toContain("digest-fanout");
  });

  it("enqueues nothing for a cron it does not know", () => {
    expect(CronSchedule.jobsFor("* * * * *", new Date())).toEqual([]);
  });
});
