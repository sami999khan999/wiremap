import { CapabilitySet } from "@loadbearing/permissions";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Can } from "../../../src/component/can/can.js";

const setFrom = (grants: readonly string[], goals: Record<string, readonly string[]> = {}) =>
  CapabilitySet.from({
    wildcard: false,
    org: { grants: [...grants], denies: [] },
    goals: Object.fromEntries(
      Object.entries(goals).map(([id, g]) => [id, { grants: [...g], denies: [] }]),
    ),
  } as never);

describe("Can", () => {
  it("renders children when the capability allows it", () => {
    render(
      <Can permission="rbac.role.read" capabilities={setFrom(["rbac.role.read"])}>
        <span>manage roles</span>
      </Can>,
    );

    expect(screen.getByText("manage roles")).toBeDefined();
  });

  it("renders nothing by default when it does not", () => {
    const { container } = render(
      <Can permission="rbac.role.read" capabilities={setFrom([])}>
        <span>manage roles</span>
      </Can>,
    );

    expect(container.textContent).toBe("");
  });

  it("renders the fallback when one is given", () => {
    render(
      <Can permission="rbac.role.read" capabilities={setFrom([])} fallback={<span>no access</span>}>
        <span>manage roles</span>
      </Can>,
    );

    expect(screen.getByText("no access")).toBeDefined();
  });

  it("calls the same CapabilitySet the server calls", () => {
    // One implementation used by both sides, not two that agree today: the component's
    // answer and a direct call have to be the same answer.
    const capabilities = setFrom(["rbac.role.read"]);
    const { container } = render(
      <Can permission="member.read" capabilities={capabilities}>
        <span>members</span>
      </Can>,
    );

    expect(capabilities.can("member.read")).toBe(false);
    expect(container.textContent).toBe("");
  });
});
