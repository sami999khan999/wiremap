import type { ActivityRecord } from "@loadbearing/application";
import { afterAll, describe, expect, inject, it } from "vitest";
import {
  ClickHouseAnalyticsProjector,
  ClickHouseAnalyticsReader,
  ClickHouseConnection,
} from "../../src/clickhouse/index.js";
import { type OrganizationId, Uuid } from "../../src/import.js";
import type {} from "./support/stack.js";

const stack = inject("stack");

// `23.14`: the reader against the running store, fed by the real projector, so the day
// and the dedupe are the ones the dashboard will actually see.
describe.skipIf(!stack.clickhouse)("ClickHouseAnalyticsReader against the running store", () => {
  const config = stack.clickhouse ?? { url: "", database: "", username: "", password: "" };
  const connection = new ClickHouseConnection(config);
  const projector = new ClickHouseAnalyticsProjector(connection);
  const reader = new ClickHouseAnalyticsReader(connection);

  const tenant = Uuid.v7() as OrganizationId;
  const neighbour = Uuid.v7() as OrganizationId;

  const record = (
    organizationId: OrganizationId,
    occurredAt: string,
    action: string,
    id = Uuid.v7(),
  ): ActivityRecord => ({
    id,
    organizationId,
    occurredAt: new Date(occurredAt),
    actorId: Uuid.v7() as ActivityRecord["actorId"],
    action,
    subjectId: null,
    payload: {},
  });

  afterAll(async () => {
    await connection.command(
      `ALTER TABLE ${connection.qualified("activity_events")} DELETE WHERE organization_id IN ('${tenant}', '${neighbour}') SETTINGS mutations_sync = 1`,
    );
    await connection.close();
  });

  it("counts per UTC day and action, once per row, for one tenant, inside the window", async () => {
    const twice = Uuid.v7();
    await projector.project([
      record(tenant, "2026-09-01T00:00:00.000Z", "member.joined"),
      record(tenant, "2026-09-01T23:59:59.999Z", "member.joined"),
      record(tenant, "2026-09-01T12:00:00.000Z", "role.created"),
      record(tenant, "2026-09-02T08:00:00.000Z", "member.joined", twice),
      // Outside `[from, to)` on both sides: the day before, and `to` itself.
      record(tenant, "2026-08-31T23:59:59.999Z", "member.joined"),
      record(tenant, "2026-09-03T00:00:00.000Z", "member.joined"),
      // Another tenant's row on a day this one has rows too.
      record(neighbour, "2026-09-01T10:00:00.000Z", "member.joined"),
    ]);
    // The projection is at-least-once: a redelivered row must not count twice.
    await projector.project([record(tenant, "2026-09-02T08:00:00.000Z", "member.joined", twice)]);

    expect(await reader.activityByDay(tenant, "2026-09-01", "2026-09-03")).toEqual([
      { day: "2026-09-01", action: "member.joined", count: 2 },
      { day: "2026-09-01", action: "role.created", count: 1 },
      { day: "2026-09-02", action: "member.joined", count: 1 },
    ]);
    // Two projector round trips, each an insert the store acknowledges on write.
  }, 60_000);

  it("answers an empty list for a tenant with no rows, not an error", async () => {
    expect(
      await reader.activityByDay(Uuid.v7() as OrganizationId, "2026-09-01", "2026-09-03"),
    ).toEqual([]);
  });
});
