import { ApiClient, type AppClient } from "@loadbearing/api-client";
import type { EffectiveDto, OverrideEntityDto } from "@loadbearing/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EffectivePermissionsInspector } from "../../src/rbac/effective-permissions.inspector.js";
import { PermissionOverrideForm } from "../../src/rbac/permission-override.form.js";
import { PermissionOverrideList } from "../../src/rbac/permission-override.list.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const USER = "00000000-0000-7000-8000-0000000000b1";

const row = (values: Partial<OverrideEntityDto>): OverrideEntityDto => ({
  id: "o1",
  userId: USER as OverrideEntityDto["userId"],
  permission: "member.invite",
  effect: "deny",
  authority: "org",
  reason: null,
  expiresAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...values,
});

function fakeClient(items: readonly OverrideEntityDto[] = [], effective?: EffectiveDto) {
  const calls: { procedure: string; input: unknown }[] = [];
  const record = (procedure: string) => (input: unknown) => {
    calls.push({ procedure, input });
    return Promise.resolve(procedure === "clear" ? { ok: true } : { permissions: ["x"] });
  };
  const client = ApiClient.inProcess({
    override: {
      list: () => Promise.resolve({ items }),
      grant: record("grant"),
      deny: record("deny"),
      clear: record("clear"),
    },
    role: { effective: () => Promise.resolve(effective) },
  } as unknown as AppClient);
  return { client, calls };
}

describe("PermissionOverrideList", () => {
  // The org admin sees the tier's deny and cannot lift it, and is told who can.
  it("locks a platform deny and offers a clear only on the org's own rows", async () => {
    const { client } = fakeClient([
      row({ id: "p", authority: "platform", permission: "analytics.activity.read" }),
      row({ id: "o", authority: "org", permission: "member.invite" }),
    ]);
    await renderWithFakes(
      <PermissionOverrideList userId={USER} />,
      capabilitiesWith(["rbac.override.read", "rbac.override.manage"]),
      undefined,
      ["role"],
      client,
    );

    expect(await screen.findByText("Set by the platform — contact support")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
  });

  it("offers no clear to a reader", async () => {
    const { client } = fakeClient([row({})]);
    await renderWithFakes(
      <PermissionOverrideList userId={USER} />,
      capabilitiesWith(["rbac.override.read"]),
      undefined,
      ["role"],
      client,
    );

    await screen.findByText("member.invite");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

describe("PermissionOverrideForm", () => {
  it("sends a grant with its reason and no date, which the server reads as thirty days", async () => {
    const { client, calls } = fakeClient();
    await renderWithFakes(
      <PermissionOverrideForm userId={USER} />,
      capabilitiesWith(["rbac.override.manage"]),
      undefined,
      ["role"],
      client,
    );

    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Add exception" });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Permission"), {
      target: { value: "analytics.activity.read" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "covering" } });
    fireEvent.click(submit);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      procedure: "grant",
      input: {
        userId: USER,
        permission: "analytics.activity.read",
        reason: "covering",
        expiresAt: null,
      },
    });
  });

  it("sends a deny with no reason and no date field at all", async () => {
    const { client, calls } = fakeClient();
    await renderWithFakes(
      <PermissionOverrideForm userId={USER} />,
      capabilitiesWith(["rbac.override.manage"]),
      undefined,
      ["role"],
      client,
    );

    fireEvent.change(screen.getByLabelText("Effect"), { target: { value: "deny" } });
    expect(screen.queryByLabelText("Until (at most 90 days; leave empty for 30)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add exception" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.procedure).toBe("deny");
    expect(calls[0]?.input).toMatchObject({ reason: null });
  });
});

describe("EffectivePermissionsInspector — sources", () => {
  // Each answer says where it came from, broadest cause first.
  it("names a role grant, an exception, a plan's ceiling and a platform deny", async () => {
    const effective: EffectiveDto = {
      capabilities: {
        wildcard: false,
        org: { grants: ["member.read", "rbac.role.read"], denies: ["member.invite"] },
        goals: {},
      },
      explanation: {
        roleGrants: ["member.read", "analytics.activity.read"],
        goalGrants: {},
        overrides: [
          {
            id: "g",
            permission: "rbac.role.read",
            effect: "grant",
            goalId: null,
            authority: "org",
            reason: "r",
            expiresAt: new Date("2026-10-01T00:00:00Z"),
          },
          {
            id: "d",
            permission: "member.invite",
            effect: "deny",
            goalId: null,
            authority: "platform",
            reason: null,
            expiresAt: null,
          },
        ],
        entitled: ["member.read", "rbac.role.read", "member.invite"],
      },
    };
    const { client } = fakeClient([], effective);
    await renderWithFakes(
      <EffectivePermissionsInspector userId={USER} />,
      capabilitiesWith(["rbac.effective.inspect"]),
      undefined,
      ["common", "role"],
      client,
    );

    const line = async (key: string) =>
      (await screen.findByText(key)).closest("li")?.textContent ?? "";
    expect(await line("member.read")).toContain("from their role");
    expect(await line("rbac.role.read")).toContain("an exception");
    expect(await line("analytics.activity.read")).toContain("not in your plan");
    expect(await line("member.invite")).toContain("denied by the platform");
  });
});
