import { ApiClient, type AppClient } from "@loadbearing/api-client";
import type { AccountDto } from "@loadbearing/contracts";
import type { CapabilitySetDto, PermissionKey } from "@loadbearing/permissions";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountPanel } from "../../src/platform/account.panel.js";
import { renderWithFakes } from "../support/render-with-fakes.js";

const ACME =
  "00000000-0000-7000-8000-0000000000a1" as AccountDto["memberships"][number]["organizationId"];

const ACCOUNT: AccountDto = {
  userId: "00000000-0000-7000-8000-000000000002" as AccountDto["userId"],
  email: "bob@example.test",
  name: "Bob",
  suspendedAt: null,
  memberships: [
    { organizationId: ACME, name: "Acme", slug: "acme", roleName: "Member", deactivated: true },
  ],
  denies: [
    {
      id: "deny-1",
      organizationId: ACME,
      permission: "apikey.read",
      reason: "abuse",
      createdAt: new Date("2026-09-29T00:00:00Z"),
    },
  ],
};

// The platform axis, which `capabilitiesWith` does not fill: every key here is platform.
const platform = (...grants: readonly PermissionKey[]): CapabilitySetDto => ({
  wildcard: false,
  org: { grants: [], denies: [] },
  goals: {},
  platform: { grants, denies: [] },
});

function fakeClient(account: AccountDto) {
  const calls: { procedure: string; input: unknown }[] = [];
  const record = (procedure: string) => (input: unknown) => {
    calls.push({ procedure, input });
    return Promise.resolve(
      procedure === "denyAccountPermission" ? { permissions: [] } : { ok: true },
    );
  };
  const client = ApiClient.inProcess({
    platform: {
      findAccount: (input: unknown) => {
        calls.push({ procedure: "findAccount", input });
        return Promise.resolve(account);
      },
      suspendAccount: record("suspendAccount"),
      reinstateAccount: record("reinstateAccount"),
      denyAccountPermission: record("denyAccountPermission"),
      clearAccountDeny: record("clearAccountDeny"),
    },
  } as unknown as AppClient);
  return { client, calls };
}

const renderPanel = async (account: AccountDto, capabilities: CapabilitySetDto) => {
  const fake = fakeClient(account);
  await renderWithFakes(<AccountPanel />, capabilities, undefined, ["platform"], fake.client);
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: " bob@example.test " },
  });
  fireEvent.submit(screen.getByLabelText("Email address").closest("form") as HTMLFormElement);
  await screen.findByText("bob@example.test");
  return fake;
};

describe("AccountPanel", () => {
  it("looks the account up by the trimmed address, and shows its tenants and denies", async () => {
    const { calls } = await renderPanel(ACCOUNT, platform("platform.account.read"));

    expect(calls[0]).toEqual({ procedure: "findAccount", input: { email: "bob@example.test" } });
    // Twice: the tenant it belongs to, and the tenant the deny lives in.
    expect(screen.getAllByText("Acme")).toHaveLength(2);
    expect(screen.getByText("Deactivated by the organization")).toBeTruthy();
    expect(screen.getByText("apikey.read")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  // Read is enough to see; every control is an affordance for `platform.account.manage`.
  it("offers no control to a caller who may only read", async () => {
    await renderPanel(ACCOUNT, platform("platform.account.read"));

    expect(screen.queryByRole("button", { name: "Suspend everywhere" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });

  // A reason first: it is audited in every tenant the account belongs to.
  it("suspends only once a reason is given", async () => {
    const { calls } = await renderPanel(
      ACCOUNT,
      platform("platform.account.read", "platform.account.manage"),
    );
    const button = screen.getByRole("button", { name: "Suspend everywhere" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Reason \(every organization/), {
      target: { value: "compromised" },
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(calls).toContainEqual({
        procedure: "suspendAccount",
        input: { userId: ACCOUNT.userId, reason: "compromised" },
      }),
    );
  });

  it("offers a reinstate instead once the account is suspended", async () => {
    await renderPanel(
      { ...ACCOUNT, suspendedAt: new Date("2026-09-29T00:00:00Z") },
      platform("platform.account.read", "platform.account.manage"),
    );

    expect(screen.getByRole("button", { name: "Reinstate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suspend everywhere" })).toBeNull();
  });

  it("clears a platform deny in the tenant it lives in", async () => {
    const { calls } = await renderPanel(
      ACCOUNT,
      platform("platform.account.read", "platform.account.manage"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        procedure: "clearAccountDeny",
        input: { organizationId: ACME, overrideId: "deny-1" },
      }),
    );
  });
});
