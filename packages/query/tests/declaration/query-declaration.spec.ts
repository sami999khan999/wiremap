import { describe, expect, it } from "vitest";
import { QueryKeys } from "../../src/key/index.js";
import { MemberQueries } from "../../src/member/member.queries.js";
import { RoleQueries } from "../../src/rbac/role.queries.js";

const PAGE = { limit: 25, offset: 0 };
const USER = "018f8c00-0000-7000-8000-000000000011";

const clientOver = () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve({ items: [], total: 0 });
    };

  return {
    calls,
    client: {
      member: { list: record("member.list"), listInvitations: record("member.listInvitations") },
      role: { list: record("role.list"), effective: record("role.effective") },
    } as never,
  };
};

describe("MemberQueries", () => {
  // The key mirrors the procedure path, which is what lets `QueryKeys.member.all()`
  // invalidate both of these by prefix.
  it("keys each read under the member namespace, with its params", () => {
    const { client } = clientOver();

    expect(MemberQueries.list(client, PAGE).queryKey).toEqual(QueryKeys.member.list(PAGE));
    expect(MemberQueries.invitations(client, PAGE).queryKey).toEqual(
      QueryKeys.member.invitations(PAGE),
    );
  });

  it("calls the procedure the key names, with the same params", async () => {
    const { client, calls } = clientOver();

    await MemberQueries.list(client, PAGE).queryFn?.({} as never);
    await MemberQueries.invitations(client, PAGE).queryFn?.({} as never);

    expect(calls).toEqual([
      { method: "member.list", args: [PAGE] },
      { method: "member.listInvitations", args: [PAGE] },
    ]);
  });

  // An invitation can be accepted from another device at any moment, and a claimed row
  // on screen lies about what it shows — so it goes stale sooner than the member list.
  it("holds the invitation list for less time than the member list", () => {
    const { client } = clientOver();

    expect(MemberQueries.list(client, PAGE).staleTime).toBe(60_000);
    expect(MemberQueries.invitations(client, PAGE).staleTime).toBe(10_000);
  });
});

describe("RoleQueries", () => {
  it("keys each read under the rbac namespace", () => {
    const { client } = clientOver();

    expect(RoleQueries.list(client, PAGE).queryKey).toEqual(QueryKeys.rbac.roles(PAGE));
    expect(RoleQueries.effective(client, USER).queryKey).toEqual(QueryKeys.rbac.effective(USER));
  });

  it("passes the user id as the procedure's input object, not as a bare argument", async () => {
    const { client, calls } = clientOver();

    await RoleQueries.effective(client, USER).queryFn?.({} as never);

    expect(calls).toEqual([{ method: "role.effective", args: [{ userId: USER }] }]);
  });

  // An inspector is read to answer "why can they do that", and a cached answer is the
  // wrong one — so this is the query that must never be served from the cache.
  it("never serves the effective-permission inspector from cache", () => {
    const { client } = clientOver();

    expect(RoleQueries.effective(client, USER).staleTime).toBe(0);
    expect(RoleQueries.list(client, PAGE).staleTime).toBe(60_000);
  });
});

describe("the two are distinguishable by key", () => {
  // Two lists with the same params must not collide, or a member page renders roles.
  it("does not collide across namespaces on the same params", () => {
    const { client } = clientOver();

    expect(MemberQueries.list(client, PAGE).queryKey).not.toEqual(
      RoleQueries.list(client, PAGE).queryKey,
    );
  });

  it("separates two pages of the same list", () => {
    const { client } = clientOver();

    expect(MemberQueries.list(client, PAGE).queryKey).not.toEqual(
      MemberQueries.list(client, { limit: 25, offset: 25 }).queryKey,
    );
  });
});
