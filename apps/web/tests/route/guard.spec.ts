import { describe, expect, it } from "vitest";
import type { PermissionKey, SessionUser } from "~/import.js";
import { RouteGuard } from "../../src/route/-guard.js";
import { RedirectSearch } from "../../src/route/-redirect.js";

const USER: SessionUser = {
  id: "00000000-0000-7000-8000-000000000001",
  email: "ada@example.test",
  name: "Ada",
  activeOrganizationId: "00000000-0000-7000-8000-0000000000a1",
  organizations: [],
  twoFactorEnabled: false,
};

const EMPTY = { wildcard: false, org: { grants: [], denies: [] }, goals: {} };

// `beforeLoad` throws a redirect rather than returning one, and `redirect()` keeps its
// arguments under `options` — which is what every assertion here reads.
type RedirectOptions = { to?: string; search?: { redirect?: string } };

const thrownBy = (run: () => void): RedirectOptions => {
  try {
    run();
  } catch (error: unknown) {
    return (error as { options: RedirectOptions }).options;
  }
  throw new Error("expected a redirect to be thrown");
};

describe("RouteGuard.requireSession", () => {
  it("lets a signed-in user through", () => {
    expect(() =>
      RouteGuard.requireSession()({ context: { user: USER }, location: { href: "/settings" } }),
    ).not.toThrow();
  });

  // The regression guard: the redirect carried no destination, so every deep link that
  // triggered a sign-in landed on `/` — although `RedirectSearch` was already there.
  it("carries the destination it interrupted", () => {
    const thrown = thrownBy(() =>
      RouteGuard.requireSession()({
        context: { user: null },
        location: { href: "/settings/security" },
      }),
    );

    expect(thrown.to).toBe("/sign-in");
    expect(thrown.search?.redirect).toBe("/settings/security");
  });

  // And what it carries is a shape the sign-in page will accept, rather than one its
  // own `validateSearch` throws out.
  it("carries a destination the sign-in page accepts", () => {
    const thrown = thrownBy(() =>
      RouteGuard.requireSession()({
        context: { user: null },
        location: { href: "/settings/members?page=2" },
      }),
    );

    expect(RedirectSearch.target(RedirectSearch.schema.parse(thrown.search))).toBe(
      "/settings/members?page=2",
    );
  });
});

describe("RouteGuard.requirePermission", () => {
  it("sends a signed-in user who lacks the capability to /forbidden", () => {
    const thrown = thrownBy(() =>
      RouteGuard.requirePermission("rbac.role.read")({ context: { capabilities: EMPTY } }),
    );

    expect(thrown.to).toBe("/forbidden");
  });

  it("lets a holder through", () => {
    expect(() =>
      RouteGuard.requirePermission("rbac.role.read")({
        context: {
          capabilities: { ...EMPTY, org: { grants: ["rbac.role.read"], denies: [] } },
        },
      }),
    ).not.toThrow();
  });

  // The DTO is rebuilt through `CapabilitySet.from()` rather than shape-checked, which
  // is what makes a deny beat a grant here the way it does on the server.
  it("refuses a denial that sits over a grant", () => {
    const thrown = thrownBy(() =>
      RouteGuard.requirePermission("rbac.role.read")({
        context: {
          capabilities: {
            ...EMPTY,
            org: {
              grants: ["rbac.role.read"] as PermissionKey[],
              denies: ["rbac.role.read"] as PermissionKey[],
            },
          },
        },
      }),
    );

    expect(thrown.to).toBe("/forbidden");
  });

  // Every permission in the catalog is org-scoped today, so a goal id is carried and
  // ignored — and a goal grant is not a substitute for the org one the answer needs.
  it("ignores a goal id for an org-scoped permission, on both answers", () => {
    const held = {
      ...EMPTY,
      org: { grants: ["rbac.role.read"] as PermissionKey[], denies: [] },
    };
    const goalOnly = {
      ...EMPTY,
      goals: { g1: { grants: ["rbac.role.read"] as PermissionKey[], denies: [] } },
    };

    expect(() =>
      RouteGuard.requirePermission("rbac.role.read", "g1")({ context: { capabilities: held } }),
    ).not.toThrow();
    expect(
      thrownBy(() =>
        RouteGuard.requirePermission(
          "rbac.role.read",
          "g1",
        )({
          context: { capabilities: goalOnly },
        }),
      ).to,
    ).toBe("/forbidden");
  });
});
