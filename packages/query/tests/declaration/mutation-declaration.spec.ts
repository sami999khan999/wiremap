import { describe, expect, it, vi } from "vitest";

// These classes declare and nothing more: which call, which keys it invalidates, which
// cached list it edits. `useAppMutation` is stubbed so the declaration is readable.
vi.mock("../../src/runtime/index.js", () => ({
  useAppMutation: (options: Record<string, unknown>) => options,
}));

const { AccountMutations } = await import("../../src/account/account.mutations.js");
const { MemberMutations } = await import("../../src/member/member.mutations.js");
const { OrganizationMutations } = await import("../../src/organization/organization.mutations.js");
const { QueryKeys } = await import("../../src/key/index.js");

interface Declaration {
  invalidates?: readonly (readonly unknown[])[];
  optimistic?: { queryKey: readonly unknown[]; apply: (cached: never, input: never) => unknown };
  onSuccess?: (data: unknown, variables: unknown) => unknown;
}

const declare = (build: () => unknown): Declaration => build() as Declaration;

const PAGE = { limit: 25, offset: 0 };

describe("AccountMutations — what each write invalidates", () => {
  // Every other device is gone and this tab's own session survives, which is why
  // `QueryKeys.session` is absent from a password change.
  it("refetches the session list on a password change, and not the session", () => {
    const declaration = declare(() =>
      AccountMutations.useChangePassword({ changePassword: () => Promise.resolve() } as never),
    );

    expect(declaration.invalidates).toEqual([QueryKeys.account.sessions()]);
  });

  // Nothing has changed yet: a confirmation went to the old address, and the address on
  // the session only moves once that link is followed.
  it("invalidates nothing on a change of address", () => {
    const declaration = declare(() =>
      AccountMutations.useChangeEmail({ changeEmail: () => Promise.resolve() } as never),
    );

    expect(declaration.invalidates).toBeUndefined();
  });

  // Two-factor is not on until the code is verified, so invalidating at enrolment would
  // make the security page claim protection the account does not have.
  it("invalidates on verify and disable, and not on enable", () => {
    const account = {
      enableTwoFactor: () => Promise.resolve(),
      verifyTotpEnrolment: () => Promise.resolve(),
      disableTwoFactor: () => Promise.resolve(),
    } as never;

    expect(declare(() => AccountMutations.useEnableTwoFactor(account)).invalidates).toBeUndefined();
    expect(declare(() => AccountMutations.useVerifyTotpEnrolment(account)).invalidates).toEqual([
      QueryKeys.session.all(),
      QueryKeys.account.all(),
    ]);
    expect(declare(() => AccountMutations.useDisableTwoFactor(account)).invalidates).toEqual([
      QueryKeys.session.all(),
      QueryKeys.account.all(),
    ]);
  });

  it("invalidates the session on a rename, because the shell renders the name", () => {
    const declaration = declare(() =>
      AccountMutations.useUpdateName({ updateName: () => Promise.resolve() } as never),
    );

    expect(declaration.invalidates).toEqual([QueryKeys.session.all()]);
  });
});

describe("AccountMutations — the optimistic edits", () => {
  it("removes the unlinked provider from the account list, and only that one", () => {
    const declaration = declare(() =>
      AccountMutations.useUnlinkAccount({ unlinkAccount: () => Promise.resolve() } as never),
    );
    const cached = [
      { id: "1", providerId: "google", accountId: "g1" },
      { id: "2", providerId: "google", accountId: "g2" },
      { id: "3", providerId: "credential", accountId: "c1" },
    ];

    expect(declaration.optimistic?.queryKey).toEqual(QueryKeys.account.accounts());
    expect(
      declaration.optimistic?.apply(
        cached as never,
        {
          providerId: "google",
          accountId: "g1",
        } as never,
      ),
    ).toEqual([cached[1], cached[2]]);
  });

  it("removes the revoked session by token", () => {
    const declaration = declare(() =>
      AccountMutations.useRevokeSession({ revokeSession: () => Promise.resolve() } as never),
    );
    const cached = [{ token: "here" }, { token: "there" }];

    expect(declaration.optimistic?.queryKey).toEqual(QueryKeys.account.sessions());
    expect(declaration.optimistic?.apply(cached as never, { token: "there" } as never)).toEqual([
      { token: "here" },
    ]);
  });
});

describe("MemberMutations", () => {
  const client = {
    member: {
      invite: () => Promise.resolve(),
      revokeInvitation: () => Promise.resolve(),
      changeRole: () => Promise.resolve(),
      deactivate: () => Promise.resolve(),
      reactivate: () => Promise.resolve(),
    },
  } as never;

  // The whole namespace, not just the invitation list: a re-invite replaces a pending
  // row and the member list sits beside it, so both refetch together.
  it("invalidates the whole member namespace on an invite", () => {
    expect(declare(() => MemberMutations.useInvite(client)).invalidates).toEqual([
      QueryKeys.member.all(),
    ]);
  });

  // The effective-permission key is per user, and a role change is the write that
  // changes what it answers.
  it("invalidates rbac too on a role change, and not on a deactivation", () => {
    expect(declare(() => MemberMutations.useChangeRole(client)).invalidates).toEqual([
      QueryKeys.member.all(),
      QueryKeys.rbac.all(),
    ]);
    expect(declare(() => MemberMutations.useDeactivate(client)).invalidates).toEqual([
      QueryKeys.member.all(),
    ]);
  });

  // The count under a list that just shrank is wrong until the refetch lands, which is
  // the moment the optimistic edit exists to cover.
  it("removes the revoked invitation from the page it was revoked from, and its total", () => {
    const declaration = declare(() => MemberMutations.useRevokeInvitation(client, PAGE));
    const page = { items: [{ id: "a" }, { id: "b" }], total: 2 };

    expect(declaration.optimistic?.queryKey).toEqual(QueryKeys.member.invitations(PAGE));
    expect(declaration.optimistic?.apply(page as never, { invitationId: "a" } as never)).toEqual({
      items: [{ id: "b" }],
      total: 1,
    });
  });

  it("never takes the total below zero", () => {
    const declaration = declare(() => MemberMutations.useRevokeInvitation(client, PAGE));
    const page = { items: [], total: 0 };
    const edited = declaration.optimistic?.apply(
      page as never,
      {
        invitationId: "a",
      } as never,
    ) as { total: number };

    expect(edited.total).toBe(0);
  });
});

describe("OrganizationMutations", () => {
  const client = {
    switch: () => Promise.resolve(),
    create: () => Promise.resolve(),
    acceptInvitation: () => Promise.resolve(),
  } as never;

  // None declares `invalidates`: the whole cache belongs to the tenant just left, and a
  // named subset would leave the rest of it answering for the wrong organization.
  it("invalidates nothing on any of the three, and hands the callback through", () => {
    const done = vi.fn();

    for (const build of [
      () => OrganizationMutations.useSwitch(client, done),
      () => OrganizationMutations.useCreate(client, done),
      () => OrganizationMutations.useAcceptInvitation(client, done),
    ]) {
      const declaration = declare(build);

      expect(declaration.invalidates).toBeUndefined();
      expect(declaration.onSuccess).toBe(done);
    }
  });
});
