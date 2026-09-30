import { RetentionRules } from "@loadbearing/application";
import { afterAll, describe, expect, inject, it } from "vitest";
import { ClickHouseAnalyticsProjector, ClickHouseConnection } from "../../src/clickhouse/index.js";
import type {} from "./support/stack.js";

const stack = inject("stack");

// Four years old: outside a twelve-month default, inside a 120-month per-action rule.
const OLD = "2022-01-01 00:00:00";
const PROBE = "ttl_probe";

// `skipIf`, not a bare `if`: a suite that silently contains no tests is indistinguishable
// from one that ran, and the reason belongs in the report.
describe.skipIf(!stack.clickhouse)("The analytics TTL, against the running store", () => {
  const config = stack.clickhouse ?? { url: "", database: "", username: "", password: "" };
  const connection = new ClickHouseConnection(config);
  const projector = new ClickHouseAnalyticsProjector(connection);

  afterAll(async () => {
    await connection.command(`DROP TABLE IF EXISTS ${connection.qualified(PROBE)}`);
    await connection.close();
  });

  // Rows surviving a forced merge under one TTL. The merge is forced rather than waited
  // for: TTL is applied on merge, and the background pass is on its own schedule.
  const survives = async (ttl: string): Promise<number> => {
    const table = connection.qualified(PROBE);
    await connection.command(`DROP TABLE IF EXISTS ${table}`);
    await connection.command(`
      CREATE TABLE ${table} (action String, occurred_at DateTime)
      ENGINE = MergeTree ORDER BY occurred_at TTL ${ttl}
    `);
    await connection.command(
      `INSERT INTO ${table} (action, occurred_at) VALUES ('role.created', '${OLD}')`,
    );
    await connection.command(`OPTIMIZE TABLE ${table} FINAL`);

    const rows = await connection.query<{ n: number }>(
      `SELECT toUInt32(count()) AS n FROM ${table}`,
    );
    await connection.command(`DROP TABLE ${table}`);

    return rows[0]?.n ?? 0;
  };

  const LONG = "toDateTime(occurred_at) + toIntervalMonth(120) WHERE action = 'role.created'";
  const NAKED = "toDateTime(occurred_at) + toIntervalMonth(12)";

  // **The reason the default clause is guarded**, and the only place it can be shown:
  // no amount of unit testing a string proves what the store does with it.
  it("deletes a row a longer per-action clause was keeping, when the default is naked", async () => {
    expect(await survives(LONG)).toBe(1);
    expect(await survives(`${LONG}, ${NAKED}`)).toBe(0);
    expect(await survives(`${LONG}, ${NAKED} WHERE action NOT IN ('role.created')`)).toBe(1);
  });

  // ClickHouse rewrites `INTERVAL n MONTH` and strips a `DELETE`, so a composer that
  // emitted either would make the nightly reconcile rewrite the table every run.
  it("round-trips the composed expression exactly", async () => {
    const before = await projector.retention();
    const expression = RetentionRules.clickhouseTtlFor(60, [
      { action: "ai.document.searched", months: 3 },
      { action: "role.created", months: 120 },
    ]);

    try {
      await projector.applyRetention(expression);
      expect(await projector.retention()).toBe(expression);
    } finally {
      await projector.applyRetention(before);
    }

    expect(await projector.retention()).toBe(before);
  });
});
