import type { ApiClient } from "@loadbearing/api-client";
import type { InvitationDto } from "@loadbearing/contracts";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InvitationList } from "../../src/member/invitation-list.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const INVITATION: InvitationDto = {
  id: "00000000-0000-7000-8000-0000000000d1" as InvitationDto["id"],
  email: "invitee@example.test",
  roleId: "00000000-0000-7000-8000-0000000000c1" as InvitationDto["roleId"],
  roleName: "Member",
  invitedBy: "00000000-0000-7000-8000-000000000001" as InvitationDto["invitedBy"],
  inviterName: "Ada",
  organizationName: "Acme",
  expiresAt: new Date("2026-09-10T00:00:00.000Z"),
  createdAt: new Date("2026-09-03T00:00:00.000Z"),
};

const clientWith = (listInvitations: () => Promise<unknown>) =>
  ({ member: { listInvitations, revokeInvitation: vi.fn() } }) as unknown as ApiClient;

const render = (listInvitations: () => Promise<unknown>) =>
  renderWithFakes(
    <InvitationList />,
    capabilitiesWith([]),
    undefined,
    ["member", "common"],
    clientWith(listInvitations),
  );

describe("InvitationList", () => {
  // The regression guard: it returned `null` while pending, so the panel looked like it
  // held no invitations and then grew one.
  it("says it is loading rather than nothing at all", async () => {
    await render(() => new Promise(() => undefined));

    expect(screen.getByText("Loading…")).toBeDefined();
  });

  it("says something went wrong rather than saying there are none", async () => {
    await render(() => Promise.reject(new Error("nope")));

    await waitFor(() =>
      expect(screen.getByText("Something went wrong. Please try again.")).toBeDefined(),
    );
  });

  it("says there are none only when there are none", async () => {
    await render(() => Promise.resolve({ items: [], total: 0 }));

    await waitFor(() => expect(screen.getByText("No pending invitations.")).toBeDefined());
  });

  it("lists what came back", async () => {
    await render(() => Promise.resolve({ items: [INVITATION], total: 1 }));

    await waitFor(() => expect(screen.getByText("invitee@example.test")).toBeDefined());
  });
});
