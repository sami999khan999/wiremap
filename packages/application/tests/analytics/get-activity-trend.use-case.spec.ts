import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { ActivityCount, AnalyticsReader } from "../../src/analytics/analytics.reader.js";
import { GetActivityTrendUseCase } from "../../src/analytics/get-activity-trend.use-case.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

// Late in the day on purpose: a window computed from the clock rather than from
// midnight would start mid-day and cut the first day short.
const clock = { now: () => new Date("2026-09-25T21:30:00.000Z") };

class RecordingReader implements AnalyticsReader {
  public readonly asked: { organizationId: OrganizationId; from: string; to: string }[] = [];

  public activityByDay(
    organizationId: OrganizationId,
    from: string,
    to: string,
  ): Promise<readonly ActivityCount[]> {
    this.asked.push({ organizationId, from, to });
    return Promise.resolve([{ day: "2026-09-25", action: "member.joined", count: 3 }]);
  }
}

const actor = (grants: readonly PermissionKey[]) =>
  new Principal(
    TENANT,
    ACTOR,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );

describe("GetActivityTrendUseCase", () => {
  it("asks for whole UTC days, today included, for the actor's own tenant", async () => {
    const reader = new RecordingReader();
    const trend = await new GetActivityTrendUseCase(new Authorizer(), reader, clock).execute(
      actor(["analytics.activity.read"]),
      { days: 30 },
    );

    expect(reader.asked).toEqual([
      { organizationId: TENANT, from: "2026-08-27", to: "2026-09-26" },
    ]);
    expect(trend).toEqual({
      configured: true,
      from: "2026-08-27",
      to: "2026-09-26",
      points: [{ day: "2026-09-25", action: "member.joined", count: 3 }],
    });
  });

  it("covers ninety days when asked for ninety", async () => {
    const reader = new RecordingReader();
    await new GetActivityTrendUseCase(new Authorizer(), reader, clock).execute(
      actor(["analytics.activity.read"]),
      { days: 90 },
    );

    expect(reader.asked[0]).toMatchObject({ from: "2026-06-28", to: "2026-09-26" });
  });

  // The third state: no store is neither an empty tenant nor a failure.
  it("says not configured, with the window, when the deployment runs no store", async () => {
    const trend = await new GetActivityTrendUseCase(new Authorizer(), null, clock).execute(
      actor(["analytics.activity.read"]),
      { days: 30 },
    );

    expect(trend).toEqual({ configured: false, from: "2026-08-27", to: "2026-09-26", points: [] });
  });

  it("refuses an actor without the key, before asking the store", async () => {
    const reader = new RecordingReader();

    await expect(
      new GetActivityTrendUseCase(new Authorizer(), reader, clock).execute(actor(["member.read"]), {
        days: 30,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(reader.asked).toEqual([]);
  });
});
