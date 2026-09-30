import { ApiClient, type AppClient } from "@loadbearing/api-client";
import type { CapabilitySetDto, PermissionKey } from "@loadbearing/permissions";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModuleSwitchPanel } from "../../src/platform/module-switch.panel.js";
import { PlanForm } from "../../src/platform/plan.form.js";
import { renderWithFakes } from "../support/render-with-fakes.js";

const platform = (...grants: readonly PermissionKey[]): CapabilitySetDto => ({
  wildcard: false,
  org: { grants: [], denies: [] },
  goals: {},
  platform: { grants, denies: [] },
});

function fakeClient() {
  const calls: { procedure: string; input: unknown }[] = [];
  const client = ApiClient.inProcess({
    platform: {
      savePlan: (input: unknown) => {
        calls.push({ procedure: "savePlan", input });
        return Promise.resolve({ ok: true });
      },
      moduleSwitches: () =>
        Promise.resolve({
          items: [{ module: "messaging", enabled: true, reason: null, disabledAt: null }],
        }),
      updateModuleSwitch: (input: unknown) => {
        calls.push({ procedure: "updateModuleSwitch", input });
        return Promise.resolve({ ok: true });
      },
    },
  } as unknown as AppClient);
  return { client, calls };
}

// By label, not by role: a role query walks the accessibility tree of a form with dozens
// of boxes, and at a full run's load that crosses the timeout.
const box = (key: string) => screen.getByLabelText<HTMLInputElement>(key);

describe("PlanForm", () => {
  // `RV.13` on the client: the form shows the closure the server applies anyway.
  it("ticks what a key needs, and unticks what depends on one", async () => {
    const { client } = fakeClient();
    await renderWithFakes(
      <PlanForm onDone={() => undefined} />,
      platform("platform.entitlement.manage"),
      undefined,
      ["platform"],
      client,
    );

    fireEvent.click(box("member.invite"));
    expect(box("member.read").checked).toBe(true);
    expect(box("rbac.role.read").checked).toBe(true);

    fireEvent.click(box("rbac.role.read"));
    expect(box("member.invite").checked).toBe(false);
    expect(box("member.read").checked).toBe(true);
  });

  it("offers no core and no platform key", async () => {
    const { client } = fakeClient();
    await renderWithFakes(
      <PlanForm onDone={() => undefined} />,
      platform(),
      undefined,
      ["platform"],
      client,
    );

    expect(screen.queryByLabelText("core.activity.write")).toBeNull();
    expect(screen.queryByLabelText("platform.status.read")).toBeNull();
  });

  it("saves the ticked keys, sorted, under the typed key and name", async () => {
    const { client, calls } = fakeClient();
    await renderWithFakes(
      <PlanForm onDone={() => undefined} />,
      platform("platform.entitlement.manage"),
      undefined,
      ["platform"],
      client,
    );

    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "team" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Team" } });
    fireEvent.click(box("member.read"));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      procedure: "savePlan",
      input: { key: "team", name: "Team", description: "", permissions: ["member.read"] },
    });
  });
});

describe("ModuleSwitchPanel", () => {
  // The reason is what the next person on call reads; switching off without one is refused.
  it("switches a module off only once a reason is given", async () => {
    const { client, calls } = fakeClient();
    await renderWithFakes(
      <ModuleSwitchPanel />,
      platform("platform.module.manage"),
      undefined,
      ["platform"],
      client,
    );

    const off = await screen.findByRole<HTMLButtonElement>("button", { name: "Switch off" });
    expect(off.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Reason — messaging"), {
      target: { value: "incident" },
    });
    fireEvent.click(off);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.input).toEqual({ module: "messaging", enabled: false, reason: "incident" });
  });
});
