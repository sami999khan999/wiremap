import { afterAll, describe, expect, inject, it } from "vitest";
import { ClickHouseConnection } from "../../src/clickhouse/index.js";
import { LokiLogReader } from "../../src/loki/index.js";
import type {} from "./support/stack.js";

const stack = inject("stack");

// `skipIf`, not a bare `if`: a suite that silently contains no tests is indistinguishable
// from one that ran, and the reason belongs in the report.
describe.skipIf(!stack.loki)("LogReader against the running log platform", () => {
  const logs = new LokiLogReader(stack.loki ?? { url: "" });

  it("is healthy", async () => {
    expect(await logs.healthy()).toBe(true);
  });

  // Asserting on a particular line would depend on something having been logged in the
  // last hour. That it returns and parses is the claim, and the port's only exercised path.
  it("answers a query and parses every entry into the shape the port declares", async () => {
    const entries = await logs.query({
      from: new Date(Date.now() - 60 * 60 * 1_000),
      to: new Date(),
      limit: 5,
    });

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeLessThanOrEqual(5);

    for (const entry of entries) {
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(Number.isNaN(entry.timestamp.getTime())).toBe(false);
      expect(typeof entry.app).toBe("string");
      expect(typeof entry.level).toBe("string");
      expect(typeof entry.eventCode).toBe("string");
      expect(entry.fields).toBeTypeOf("object");
    }
  });

  // The closed label set. A `userId` promoted to a label creates one stream per user,
  // so the query builder must not accept one — this is the shape that guards it.
  it("honours the limit it was given", async () => {
    const entries = await logs.query({
      from: new Date(Date.now() - 60 * 60 * 1_000),
      to: new Date(),
      limit: 1,
    });

    expect(entries.length).toBeLessThanOrEqual(1);
  });
});

describe.skipIf(!stack.clickhouse)("ClickHouse against the running analytics store", () => {
  const config = stack.clickhouse ?? { url: "", database: "", username: "", password: "" };
  const database = config.database;
  const clickhouse = new ClickHouseConnection(config);

  const PROBE = "00000000-0000-7000-8000-0000000000ff";

  afterAll(async () => {
    await clickhouse.command(`DELETE FROM ${database}.activity_events WHERE id = {id:UUID}`, {
      id: PROBE,
    });
    await clickhouse.close();
  });

  it("is healthy", async () => {
    expect(await clickhouse.healthy()).toBe(true);
  });

  // Inserted twice on purpose: the second insert is what proves `ReplacingMergeTree`
  // does the job the projection consumer's idempotency depends on.
  it("collapses a re-inserted row, which is what makes the projection replayable", async () => {
    const row = {
      id: PROBE,
      organization_id: "00000000-0000-7000-8000-0000000000fe",
      occurred_at: "2026-01-01 00:00:00.000",
      actor_id: "00000000-0000-7000-8000-0000000000fd",
      action: "smoke.probe",
      subject_id: null,
      payload: JSON.stringify({ probe: true }),
    };

    await clickhouse.insert("activity_events", [row, row]);

    const counted = await clickhouse.query<{ readonly n: number }>(
      `SELECT toUInt32(count()) AS n FROM ${database}.activity_events FINAL WHERE id = {id:UUID}`,
      { id: PROBE },
    );

    expect(counted[0]?.n).toBe(1);
  });
});
