import { describe, expect, it } from "vitest";
import { Identifiers, type OrganizationId, type TaskId } from "../../src/primitive/identifiers.js";

const UUID = "018f2b3c-4d5e-7f80-9a1b-2c3d4e5f6071";

describe("Identifiers", () => {
  it("parses a v7 uuid", () => {
    expect(Identifiers.taskId.parse(UUID)).toBe(UUID);
  });

  it("rejects a non-uuid", () => {
    expect(Identifiers.taskId.safeParse("task-1").success).toBe(false);
    expect(Identifiers.taskId.safeParse("").success).toBe(false);
  });

  it("carries no message of its own", () => {
    const result = Identifiers.taskId.safeParse("nope");
    expect(result.success).toBe(false);
    // Zod's own text, never ours. `content` renders the sentence from the rule name.
    expect(result.error?.issues[0]?.code).toBe("invalid_format");
  });

  it("brands, so two id types are not interchangeable", () => {
    const taskId: TaskId = Identifiers.taskId.parse(UUID);
    const goalId = Identifiers.goalId.parse(UUID);

    // Same string at runtime, different types at compile time. Assigning `goalId`
    // to `taskId` is a TS2322 — the check this brand exists for.
    expect(taskId).toBe(goalId);
    // @ts-expect-error a GoalId is not a TaskId
    const wrong: TaskId = goalId;
    expect(wrong).toBe(UUID);
  });

  it("brands the tenant key, where a swap is a cross-tenant leak", () => {
    const organizationId: OrganizationId = Identifiers.organizationId.parse(UUID);
    const goalId = Identifiers.goalId.parse(UUID);

    expect(organizationId).toBe(goalId);
    // @ts-expect-error a GoalId is not an OrganizationId
    const wrong: OrganizationId = goalId;
    expect(wrong).toBe(UUID);
  });
});
