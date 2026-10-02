import type { ApiClient } from "@loadbearing/api-client";
import type { RoleDto } from "@loadbearing/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoleMatrix } from "../../src/rbac/role-matrix.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const SUPPORT: RoleDto = {
  id: "00000000-0000-7000-8000-0000000000e1" as RoleDto["id"],
  key: "support",
  name: "Support",
  description: null,
  scope: "org",
  isSystem: false,
  permissions: ["member.read", "platform.account.read"],
};

const render = async () => {
  const grant = vi.fn().mockResolvedValue(SUPPORT);
  const revoke = vi.fn().mockResolvedValue({ ...SUPPORT, permissions: ["member.read"] });
  const client = {
    role: {
      list: () => Promise.resolve({ items: [SUPPORT], total: 1 }),
      entitlement: () => Promise.resolve({ keys: null }),
      grant,
      revoke,
    },
  } as unknown as ApiClient;

  await renderWithFakes(
    <RoleMatrix />,
    capabilitiesWith(["rbac.permission.grant", "rbac.permission.revoke"]),
    undefined,
    ["role", "common"],
    client,
    [],
    true,
  );
  return { grant, revoke };
};

const cell = (permission: string) =>
  screen.getByRole("checkbox", { name: `Support — ${permission}` }) as HTMLInputElement;

// In the platform organization a role may hold platform keys; the grid must read them from
// the platform axis, or a held key shows unticked and a click revokes it.
describe("RoleMatrix in the platform organization", () => {
  it("shows a held platform key as ticked, beside a held tenant key", async () => {
    await render();
    await waitFor(() => expect(cell("platform.account.read").checked).toBe(true));
    expect(cell("member.read").checked).toBe(true);
    expect(cell("platform.status.read").checked).toBe(false);
  });

  it("revokes a held platform key and grants one it lacks", async () => {
    const { grant, revoke } = await render();
    await waitFor(() => expect(cell("platform.account.read").checked).toBe(true));

    fireEvent.click(cell("platform.account.read"));
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith({
        roleId: SUPPORT.id,
        permission: "platform.account.read",
      }),
    );

    fireEvent.click(cell("platform.status.read"));
    await waitFor(() =>
      expect(grant).toHaveBeenCalledWith({
        roleId: SUPPORT.id,
        permission: "platform.status.read",
      }),
    );
  });
});
