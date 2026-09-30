import { Identifiers } from "@loadbearing/contracts";
import { ConflictError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type { PlatformPolicyRepository } from "../../src/platform/platform-policy.repository.js";
import { RelocateTenantUseCase } from "../../src/platform/relocate-tenant.use-case.js";
import { Shard } from "../../src/primitive/shard.js";
import { FakeActivity, FakeAssignments, FakeMoveGateway, unmoved } from "./tenant-move-doubles.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const KEY = Shard.keyOf(TENANT);
const NOW = new Date("2026-09-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const build = (options: { graceDays?: number | null; assignments?: FakeAssignments } = {}) => {
  const assignments = options.assignments ?? new FakeAssignments([unmoved(KEY, 0)]);
  const move = new FakeMoveGateway();
  const activity = new FakeActivity();
  const policy = {
    get: () => Promise.resolve({ moveGraceDays: options.graceDays ?? null }),
  } as unknown as PlatformPolicyRepository;
  const platform = {
    organizationId: () => Promise.resolve(PLATFORM),
  } as unknown as PlatformReader;

  move.seed(0, "messages", 5);
  move.seed(0, "notifications", 2);

  return {
    assignments,
    move,
    activity,
    useCase: new RelocateTenantUseCase(
      assignments,
      move,
      policy,
      platform,
      activity,
      { now: () => NOW },
      7,
    ),
  };
};

const input = { organizationId: TENANT, toNode: 1, actorId: ACTOR };

describe("RelocateTenantUseCase", () => {
  // The order is the whole of the safety argument: a copy before the quiesce reads a
  // page a late writer then adds to, and a copy before the prepare has nowhere to land.
  it("quiesces the source, prepares the target, then copies", async () => {
    const { move, useCase } = build();

    await useCase.execute(input);

    expect(move.steps).toEqual([
      { step: "quiesce", node: 0 },
      { step: "prepare", node: 1 },
      { step: "copy", node: 1 },
    ]);
  });

  it("flips the tenant and keeps the way back for the grace period", async () => {
    const { assignments, useCase } = build();

    const moved = await useCase.execute(input);

    expect(moved).toEqual({
      fromNode: 0,
      toNode: 1,
      rows: 7,
      droppableAt: new Date(NOW.getTime() + 7 * DAY),
    });
    expect(await assignments.findByKey(KEY)).toMatchObject({
      node: 1,
      movingTo: null,
      movedFrom: 0,
      sourceDroppableAt: new Date(NOW.getTime() + 7 * DAY),
    });
  });

  // Null on the row is "not set", never zero: a zero would drop the source the same
  // night and take the way back with it.
  it("takes the operator's grace period over the deployment's", async () => {
    const { useCase } = build({ graceDays: 2 });
    expect((await useCase.execute(input)).droppableAt).toEqual(new Date(NOW.getTime() + 2 * DAY));
  });

  it("records the move against the platform organization, naming who asked", async () => {
    const { activity, useCase } = build();

    await useCase.execute(input);

    expect(activity.rows).toEqual([
      {
        organizationId: PLATFORM,
        action: "tenant.moved",
        payload: { organizationId: TENANT, fromNode: 0, toNode: 1, rows: 7 },
      },
    ]);
  });

  it("refuses a second move while one is in flight, and touches no node", async () => {
    const assignments = new FakeAssignments([{ ...unmoved(KEY, 0), movingTo: 1 }]);
    const { move, useCase } = build({ assignments });

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(move.steps).toEqual([]);
  });

  // A copy that reports success and delivered less is the failure the count exists for,
  // and nothing was flipped, so the tenant must be writable again where it was.
  it("refuses a copy the target cannot account for, and lifts the freeze", async () => {
    const { assignments, move, useCase } = build();
    move.lose(1);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(await assignments.findByKey(KEY)).toMatchObject({ node: 0, movingTo: null });
  });

  it("lifts the freeze when a step throws", async () => {
    const { assignments, move, useCase } = build();
    move.failAt("quiesce");

    await expect(useCase.execute(input)).rejects.toThrow("quiesce failed");
    expect(await assignments.findByKey(KEY)).toMatchObject({ node: 0, movingTo: null });
    expect(move.steps.map((entry) => entry.step)).toEqual(["quiesce"]);
  });

  // `prepare` empties the target, so a retry counts what it copied rather than what a
  // failed attempt left behind — which is also why the retry is allowed at all.
  it("succeeds on a retry after a failed attempt", async () => {
    const { assignments, move, useCase } = build();
    move.lose(1);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);

    move.lose(0);
    await useCase.execute(input);

    expect(await assignments.findByKey(KEY)).toMatchObject({ node: 1, movedFrom: 0 });
  });

  // The way back: the source copy is on the node the tenant returns to, and `prepare`
  // empties it before the copy, so a stale row there cannot survive the return.
  it("moves a tenant back to the node its source copy is on", async () => {
    const assignments = new FakeAssignments([
      { ...unmoved(KEY, 1), movedFrom: 0, sourceDroppableAt: NOW },
    ]);
    const { move, useCase } = build({ assignments });
    move.seed(1, "messages", 5);

    await useCase.execute({ ...input, toNode: 0 });

    expect(await assignments.findByKey(KEY)).toMatchObject({ node: 0, movedFrom: 1 });
  });

  it("refuses a move onward while a source copy is on a third node", async () => {
    const assignments = new FakeAssignments([
      { ...unmoved(KEY, 1), movedFrom: 0, sourceDroppableAt: NOW },
    ]);
    const { useCase } = build({ assignments });

    await expect(useCase.execute({ ...input, toNode: 2 })).rejects.toBeInstanceOf(ConflictError);
  });
});
