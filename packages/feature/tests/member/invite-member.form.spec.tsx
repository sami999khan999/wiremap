import type { ApiClient } from "@loadbearing/api-client";
import type { RoleDto } from "@loadbearing/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InviteMemberForm } from "../../src/member/invite-member.form.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";
import { choose } from "../support/select.js";

const role = (id: string, key: string, name: string): RoleDto => ({
  id: id as RoleDto["id"],
  key,
  name,
  description: null,
  scope: "org",
  isSystem: true,
  permissions: [],
});

const MEMBER = role("00000000-0000-7000-8000-0000000000c1", "member", "Member");
const ADMIN = role("00000000-0000-7000-8000-0000000000c2", "admin", "Admin");

const render = async (
  roles: readonly RoleDto[] = [MEMBER, ADMIN],
  list: () => Promise<unknown> = () => Promise.resolve({ items: roles, total: roles.length }),
) => {
  const invite = vi.fn().mockResolvedValue({ id: "i1" });
  const client = {
    role: { list },
    member: { invite },
  } as unknown as ApiClient;

  await renderWithFakes(
    <InviteMemberForm />,
    capabilitiesWith([]),
    undefined,
    ["member", "common"],
    client,
  );
  return { invite };
};

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value } });

// The trigger is named after the chosen role, which is what a reader hears.
const roleNamed = (name: string) => screen.getByRole("combobox", { name: `Role: ${name}` });

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

describe("InviteMemberForm", () => {
  it("defaults to member rather than the wildcard role", async () => {
    const { invite } = await render();

    await waitFor(() => expect(roleNamed("Member")).toBeDefined());

    type("new@example.test");
    submit();

    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({ email: "new@example.test", roleId: MEMBER.id }),
    );
  });

  // The regression guard: only the address was cleared, so the next invitation carried
  // whatever role the previous one had picked — silently.
  it("clears both fields after a successful invitation", async () => {
    const { invite } = await render();

    await waitFor(() => expect(roleNamed("Member")).toBeDefined());

    await choose(roleNamed("Member"), "Admin");
    type("new@example.test");
    submit();

    await waitFor(() => expect(invite).toHaveBeenCalled());

    expect(screen.getByLabelText("Email address")).toHaveProperty("value", "");
    await waitFor(() => expect(roleNamed("Member")).toBeDefined());
  });

  // The other half: the select paints the options it has, and the form must submit what
  // it painted — a stored id that is no longer on offer is neither.
  it("submits an option that is actually on offer", async () => {
    const { invite } = await render([ADMIN]);

    await waitFor(() => expect(roleNamed("Admin")).toBeDefined());

    type("new@example.test");
    submit();

    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({ email: "new@example.test", roleId: ADMIN.id }),
    );
  });

  // `disabled` on its own takes the control out of the tab order and says nothing about
  // why, so a reader who tabs past it has been told the role picker does not exist.
  it("says the role picker is busy while the roles are still loading", async () => {
    await render([MEMBER], () => new Promise(() => undefined));

    expect(screen.getByLabelText("Role").getAttribute("aria-busy")).toBe("true");
  });
});
