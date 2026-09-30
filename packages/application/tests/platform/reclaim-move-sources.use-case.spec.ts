import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { ReclaimMoveSourcesUseCase } from "../../src/platform/reclaim-move-sources.use-case.js";
import type { ShardAssignment } from "../../src/port/index.js";
import { Shard } from "../../src/primitive/shard.js";
import { FakeAssignments, FakeMoveGateway, unmoved } from "./tenant-move-doubles.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const PAST = new Date(NOW.getTime() - 1);
const FUTURE = new Date(NOW.getTime() + 1);

const tenant = (n: number): OrganizationId =>
  Identifiers.organizationId.parse(`018f8c00-0000-7000-8000-${String(n).padStart(12, "0")}`);

// Moved off node 0 onto node 1, with the source copy still on node 0.
const movedAway = (n: number, droppableAt: Date): ShardAssignment => ({
  ...unmoved(Shard.keyOf(tenant(n)), 1),
  movedFrom: 0,
  sourceDroppableAt: droppableAt,
});

const build = (rows: readonly ShardAssignment[]) => {
  const assignments = new FakeAssignments(rows);
  const move = new FakeMoveGateway();
  return {
    assignments,
    move,
    useCase: new ReclaimMoveSourcesUseCase(assignments, move, { now: () => NOW }),
  };
};

describe("ReclaimMoveSourcesUseCase", () => {
  // On the node it left, never the one it is on: dropping the wrong one is the tenant.
  it("drops a due source copy on the node the tenant left, and forgets the way back", async () => {
    const { assignments, move, useCase } = build([movedAway(1, PAST)]);
    move.seed(0, "messages", 4);

    const reclaimed = await useCase.execute();

    // `24.2a`: late audit rows go to the node it is on, then the source goes.
    expect(move.steps).toEqual([
      { step: "carry", node: 1 },
      { step: "drop", node: 0 },
    ]);
    expect(reclaimed).toEqual({ tenants: 1, partitions: 1 });
    expect(await assignments.findByKey(Shard.keyOf(tenant(1)))).toMatchObject({
      node: 1,
      movedFrom: null,
      sourceDroppableAt: null,
    });
  });

  it("leaves a source copy whose grace period is still open", async () => {
    const { move, useCase } = build([movedAway(1, FUTURE)]);

    expect(await useCase.execute()).toEqual({ tenants: 0, partitions: 0 });
    expect(move.steps).toEqual([]);
  });

  // A move back is copying onto the very node this would drop.
  it("leaves a tenant that is mid-move", async () => {
    const { move, useCase } = build([{ ...movedAway(1, PAST), movingTo: 0 }]);

    await useCase.execute();

    expect(move.steps).toEqual([]);
  });

  // More than one batch: each reclaimed row leaves the next read, so a loop that
  // stopped after one read would strand everything past the first fifty.
  it("keeps reading until nothing due is left", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => movedAway(index + 1, PAST));
    const { move, useCase } = build(rows);

    expect((await useCase.execute()).tenants).toBe(120);
    expect(move.steps.filter((entry) => entry.step === "drop")).toHaveLength(120);
  });
});
