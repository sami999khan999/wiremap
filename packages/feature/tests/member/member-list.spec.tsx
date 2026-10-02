import type { ApiClient } from "@loadbearing/api-client";
import type { MemberDto } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberList } from "../../src/member/member-list.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";
import { choose } from "../support/select.js";
import { transportError } from "../support/transport-error.js";

const MEMBER: MemberDto = {
  userId: "00000000-0000-7000-8000-000000000001" as MemberDto["userId"],
  name: "Ada",
  email: "ada@example.test",
  roleId: "00000000-0000-7000-8000-0000000000c1" as MemberDto["roleId"],
  roleKey: "owner",
  roleName: "Owner",
  joinedAt: new Date("2026-09-01T00:00:00.000Z"),
  deactivated: false,
  suspended: false,
  exceptions: 0,
};

const clientWith = (list: () => Promise<unknown>) => ({ member: { list } }) as unknown as ApiClient;

const render = (list: () => Promise<unknown>) =>
  renderWithFakes(<MemberList />, capabilitiesWith([]), undefined, ["member"], clientWith(list));

describe("MemberList", () => {
  it("shows a skeleton rather than a list it does not have", async () => {
    const { container } = await render(() => new Promise(() => undefined));

    expect(container.querySelector(".ui-data-table__skeleton-cell")).not.toBeNull();
  });

  // The regression guard: a failed list fell through to the empty state, so a members
  // page that could not load said the organization had no members.
  it("says something went wrong rather than saying there are no members", async () => {
    await render(() => Promise.reject(new Error("nope")));

    await waitFor(() =>
      expect(screen.getByText("Something went wrong. Please try again.")).toBeDefined(),
    );
    expect(screen.queryByText("Nobody here yet.")).toBeNull();
  });

  // The point of `useErrorMessage`: the server said *why*, and a generic sentence
  // discards it. A member reaching a page they may not read is told exactly that.
  it("renders the copy for the code the server sent, not one generic sentence", async () => {
    await render(() => Promise.reject(new ForbiddenError("member.read")));

    await waitFor(() =>
      expect(screen.getByText("You do not have permission to do that.")).toBeDefined(),
    );
    expect(screen.queryByText("Something went wrong. Please try again.")).toBeNull();
  });

  it("says the organization is empty only when it is", async () => {
    await render(() => Promise.resolve({ items: [], total: 0 }));

    await waitFor(() => expect(screen.getByText("Nobody here yet.")).toBeDefined());
    expect(screen.queryByText("Something went wrong. Please try again.")).toBeNull();
  });

  it("lists what came back", async () => {
    await render(() => Promise.resolve({ items: [MEMBER], total: 1 }));

    await waitFor(() => expect(screen.getByText("Ada")).toBeDefined());
    expect(screen.getByText("ada@example.test")).toBeDefined();
  });

  // `AX6.7`. Without it an admin spends an afternoon trying to restore someone whose lock
  // is not theirs to lift.
  it("says whose lock a suspended member is under", async () => {
    await render(() => Promise.resolve({ items: [{ ...MEMBER, suspended: true }], total: 1 }));

    await waitFor(() => expect(screen.getByText("Suspended by the platform")).toBeDefined());
    expect(screen.queryByText("Deactivated")).toBeNull();
  });

  // The refusal arrives as the transport decoded it, not as an `AppError`. Every other
  // spec in this package rejects with an instance, which is the shape HTTP never sends.
  describe("a refusal that came over the wire", () => {
    const GRACE: MemberDto = {
      ...MEMBER,
      userId: "00000000-0000-7000-8000-000000000002" as MemberDto["userId"],
      name: "Grace",
      email: "grace@example.test",
    };

    const renderWithDeactivate = (deactivate: () => Promise<unknown>) =>
      renderWithFakes(
        <MemberList />,
        capabilitiesWith(["member.deactivate"]),
        undefined,
        ["member"],
        {
          member: {
            list: () => Promise.resolve({ items: [GRACE], total: 1 }),
            deactivate,
          },
        } as unknown as ApiClient,
      );

    const clickDeactivate = async () => {
      await waitFor(() => expect(screen.getByText("Grace")).toBeDefined());
      fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    };

    // The crash: `envelope.context.reason` read `undefined.reason` and threw a
    // `TypeError` into the error boundary instead of rendering the sentence.
    it("renders the last-owner sentence rather than throwing on an absent context", async () => {
      await renderWithDeactivate(() =>
        Promise.reject(
          transportError({
            code: "CONFLICT",
            context: { resource: "member", reason: "lastOwner" },
          }),
        ),
      );
      await clickDeactivate();

      await waitFor(() =>
        expect(
          screen.getByText("This is the only active owner. Promote someone else to owner first."),
        ).toBeDefined(),
      );
    });

    // The two reasons share a code, so reading `context` is the only thing that tells
    // them apart — and it is exactly what the wire was dropping.
    it("tells the two CONFLICT reasons apart", async () => {
      await renderWithDeactivate(() =>
        Promise.reject(
          transportError({ code: "CONFLICT", context: { resource: "member", reason: "self" } }),
        ),
      );
      await clickDeactivate();

      await waitFor(() =>
        expect(screen.getByText("You cannot deactivate your own membership.")).toBeDefined(),
      );
    });
  });
});

// `AX5.7`. The drift, read from the list: "Owner + 2 exceptions", and nothing when none.
describe("MemberList — exceptions", () => {
  const listed =
    (...members: readonly MemberDto[]) =>
    () =>
      Promise.resolve({ items: members, total: members.length, limit: 25, offset: 0 });

  it("adds the count to the role, singular and plural, and nothing at zero", async () => {
    await render(
      listed(
        { ...MEMBER, exceptions: 1 },
        {
          ...MEMBER,
          userId: "00000000-0000-7000-8000-000000000002" as MemberDto["userId"],
          exceptions: 2,
        },
        { ...MEMBER, userId: "00000000-0000-7000-8000-000000000003" as MemberDto["userId"] },
      ),
    );

    expect(await screen.findByText("+ 1 exception")).toBeDefined();
    expect(screen.getByText("+ 2 exceptions")).toBeDefined();
    expect(screen.getAllByText(/exception/)).toHaveLength(2);
  });
});

// Assigning roles from the list: the picker offers only roles the viewer may hand out, and
// is absent where the use-case would refuse — your own row, or someone who outranks you.
describe("MemberList — change role", () => {
  const role = (id: string, key: string, name: string, permissions: string[] = []) => ({
    id,
    key,
    name,
    description: null,
    scope: "org",
    isSystem: false,
    permissions,
  });
  const MEMBER_ROLE = role("00000000-0000-7000-8000-0000000000c2", "member", "Member");
  const EDITOR = role("00000000-0000-7000-8000-0000000000c3", "editor", "Docs editor", [
    "doc.page.write",
  ]);
  const MANAGER = role("00000000-0000-7000-8000-0000000000c4", "manager", "Role manager", [
    "rbac.role.manage",
  ]);
  const ADMIN = role("00000000-0000-7000-8000-0000000000c5", "platform_admin", "Platform admin", [
    "platform.account.manage",
  ]);
  const grace = (roleId: string, roleName: string) => ({
    ...MEMBER,
    userId: "00000000-0000-7000-8000-000000000002" as MemberDto["userId"],
    name: "Grace",
    email: "grace@example.test",
    roleId: roleId as MemberDto["roleId"],
    roleKey: "member",
    roleName,
  });

  const mount = async (rows: readonly MemberDto[], changeRole = vi.fn()) => {
    const client = {
      member: { list: () => Promise.resolve({ items: rows, total: rows.length }), changeRole },
      role: {
        list: () => Promise.resolve({ items: [MEMBER_ROLE, EDITOR, MANAGER, ADMIN], total: 4 }),
        entitlement: () => Promise.reject(new Error("not needed")),
      },
    } as unknown as ApiClient;
    await renderWithFakes(
      <MemberList />,
      capabilitiesWith(["member.role.change", "doc.page.write"]),
      undefined,
      ["member"],
      client,
    );
    return changeRole;
  };

  it("offers only the roles the viewer may hand out, and changes on confirm", async () => {
    const changeRole = vi.fn().mockResolvedValue(grace(EDITOR.id, "Docs editor"));
    await mount([MEMBER, grace(MEMBER_ROLE.id, "Member")], changeRole);

    const picker = await screen.findByRole("combobox", { name: "Change role: Member" });
    fireEvent.click(picker);
    const offered = await screen.findAllByRole("option");
    expect(offered.map((option) => option.textContent)).toEqual(["Member", "Docs editor"]);
    fireEvent.keyDown(picker, { key: "Escape" });
    await choose(picker, "Docs editor");
    fireEvent.click(screen.getByRole("button", { name: "Change role" }));
    await waitFor(() =>
      expect(changeRole).toHaveBeenCalledWith({
        userId: "00000000-0000-7000-8000-000000000002",
        roleId: EDITOR.id,
      }),
    );
  });

  it("offers nothing on your own row", async () => {
    await mount([MEMBER]);
    await waitFor(() => expect(screen.getByText("Ada")).toBeDefined());
    expect(screen.queryByRole("combobox", { name: /Change role/ })).toBeNull();
  });

  it("offers nothing on a member whose role holds a key the viewer lacks", async () => {
    await mount([grace(ADMIN.id, "Platform admin")]);
    await waitFor(() => expect(screen.getByText("Grace")).toBeDefined());
    expect(screen.queryByRole("combobox", { name: /Change role/ })).toBeNull();
  });

  it("says so when the change would remove the last platform admin", async () => {
    const changeRole = vi.fn().mockRejectedValue(
      transportError({
        code: "CONFLICT",
        context: { resource: "member", reason: "lastPlatformAdmin" },
      }),
    );
    await mount([MEMBER, grace(MEMBER_ROLE.id, "Member")], changeRole);

    const picker = await screen.findByRole("combobox", { name: "Change role: Member" });
    await choose(picker, "Docs editor");
    fireEvent.click(screen.getByRole("button", { name: "Change role" }));
    await waitFor(() =>
      expect(screen.getByText(/only active platform administrator/)).toBeDefined(),
    );
  });
});
