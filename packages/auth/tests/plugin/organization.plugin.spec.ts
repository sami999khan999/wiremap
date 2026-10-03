import { beforeEach, describe, expect, it, vi } from "vitest";

// The cookie write needs better-auth's whole request context — signing keys, cookie
// options, the response. Stubbed at this package's outside surface, which is what it is for.
vi.mock("../../src/import.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/import.js")>()),
  setSessionCookie: vi.fn(() => Promise.resolve()),
}));

const { setSessionCookie } = await import("../../src/import.js");
const { OrganizationPlugin } = await import("../../src/plugin/organization.plugin.js");

const ORG = "018f8c00-0000-7000-8000-000000000010";
const OTHER_ORG = "018f8c00-0000-7000-8000-0000000000b0";
const USER = "018f8c00-0000-7000-8000-000000000011";

const recorder = () => ({
  sessions: [] as { token: string; activeOrganizationId: string }[],
  users: [] as { id: string; lastActiveOrganizationId: string }[],
});

interface Behaviour {
  readonly isActive?: boolean;
  readonly ownedCount?: number;
  readonly claimed?: string | null;
  readonly linkClaimed?: string | null;
  readonly sessionUpdated?: boolean;
}

const build = (behaviour: Behaviour = {}) => {
  const recorded = recorder();
  const founded: { userId: string; name: string }[] = [];

  const plugin = OrganizationPlugin.create(
    {
      isActive: () => Promise.resolve(behaviour.isActive ?? true),
      ownedCount: () => Promise.resolve(behaviour.ownedCount ?? 0),
    } as never,
    { claimByToken: () => Promise.resolve(behaviour.claimed ?? null) } as never,
    {
      found: (userId: string, name: string) => {
        founded.push({ userId, name });
        return Promise.resolve(ORG);
      },
    } as never,
    2,
    { claimByToken: () => Promise.resolve(behaviour.linkClaimed ?? null) } as never,
  );

  const endpoints = plugin.endpoints as unknown as Record<
    string,
    ((ctx: unknown) => Promise<{ organizationId: string }>) & { path: string }
  >;

  const call = (name: string, body: unknown) => {
    const endpoint = endpoints[name];
    if (!endpoint) throw new Error(`the plugin mounts no ${name}`);

    return endpoint({
      body,
      headers: new Headers(),
      context: {
        session: { session: { token: "session-token" }, user: { id: USER, email: "a@b.test" } },
        internalAdapter: {
          updateSession: (token: string, values: { activeOrganizationId: string }) => {
            recorded.sessions.push({ token, ...values });
            return Promise.resolve(
              behaviour.sessionUpdated === false ? null : { token, ...values },
            );
          },
          updateUser: (id: string, values: { lastActiveOrganizationId: string }) => {
            recorded.users.push({ id, ...values });
            return Promise.resolve({ id, ...values });
          },
        },
      },
    });
  };

  return { call, recorded, founded, endpoints };
};

beforeEach(() => {
  vi.mocked(setSessionCookie).mockClear();
});

describe("OrganizationPlugin — mounted shape", () => {
  // The paths the client calls and the rate-limit rules name. A rename here is a 404 in
  // the browser and looks identical in review to a working one.
  it("mounts the four endpoints at the paths the client calls", () => {
    const { endpoints } = build();

    expect(
      Object.values(endpoints)
        .map((endpoint) => endpoint.path)
        .sort(),
    ).toEqual([
      "/invitation-link/accept",
      "/invitation/accept",
      "/organization/create",
      "/organization/switch",
    ]);
  });
});

describe("OrganizationPlugin — switch", () => {
  // The whole authorization for a tenant switch. Without it, a session rebinds to any
  // organization id a caller can name.
  // ──
  // `CR.7`: a deactivated membership too — the session would land in a tenant that
  // answers every request anonymous.
  it("refuses a tenant the caller holds no active membership in", async () => {
    const { call, recorded } = build({ isActive: false });

    await expect(call("switchOrganization", { organizationId: OTHER_ORG })).rejects.toMatchObject({
      body: { code: "NOT_A_MEMBER" },
    });
    expect(recorded.sessions).toEqual([]);
  });

  it("rebinds the session, the user's last-active tenant, and the cookie", async () => {
    const { call, recorded } = build({ isActive: true });

    await expect(call("switchOrganization", { organizationId: ORG })).resolves.toEqual({
      organizationId: ORG,
    });

    expect(recorded.sessions).toEqual([{ token: "session-token", activeOrganizationId: ORG }]);
    expect(recorded.users).toEqual([{ id: USER, lastActiveOrganizationId: ORG }]);
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("refuses a body that is not a uuid", async () => {
    const { call } = build();

    await expect(call("switchOrganization", { organizationId: "not-a-uuid" })).rejects.toThrow();
  });
});

describe("OrganizationPlugin — create", () => {
  // The rate limit bounds the rate, not the total, and each call seeds four roles and
  // every permission the registry defines.
  it("refuses once the account owns as many tenants as it may", async () => {
    const { call, founded } = build({ ownedCount: 2 });

    await expect(call("createOrganization", { name: "Third" })).rejects.toMatchObject({
      body: { code: "ORGANIZATION_LIMIT_REACHED" },
    });
    expect(founded).toEqual([]);
  });

  it("founds under the limit and switches into what it founded", async () => {
    const { call, founded, recorded } = build({ ownedCount: 1 });

    await expect(call("createOrganization", { name: "Second" })).resolves.toEqual({
      organizationId: ORG,
    });

    expect(founded).toEqual([{ userId: USER, name: "Second" }]);
    expect(recorded.sessions).toEqual([{ token: "session-token", activeOrganizationId: ORG }]);
  });

  it("refuses an empty name and a pasted paragraph", async () => {
    const { call } = build();

    await expect(call("createOrganization", { name: "   " })).rejects.toThrow();
    await expect(call("createOrganization", { name: "a".repeat(81) })).rejects.toThrow();
  });
});

describe("OrganizationPlugin — accept", () => {
  // Null covers every refusal at once — unknown token, expired, revoked, sent elsewhere,
  // unverified — and the landing page has already said which.
  it("refuses a token the claimer will not claim, without naming why", async () => {
    const { call, recorded } = build({ claimed: null });

    await expect(call("acceptInvitation", { token: "tok" })).rejects.toMatchObject({
      body: { code: "INVITATION_NOT_CLAIMABLE" },
    });
    expect(recorded.sessions).toEqual([]);
  });

  it("switches into the tenant the invitation named", async () => {
    const { call, recorded } = build({ claimed: OTHER_ORG });

    await expect(call("acceptInvitation", { token: "tok" })).resolves.toEqual({
      organizationId: OTHER_ORG,
    });
    expect(recorded.sessions).toEqual([
      { token: "session-token", activeOrganizationId: OTHER_ORG },
    ]);
  });
});

describe("OrganizationPlugin — accept a link", () => {
  it("refuses a link the claimer will not claim, without naming why", async () => {
    const { call, recorded } = build({ linkClaimed: null });

    await expect(call("acceptInvitationLink", { token: "tok" })).rejects.toMatchObject({
      body: { code: "INVITATION_LINK_NOT_CLAIMABLE" },
    });
    expect(recorded.sessions).toEqual([]);
  });

  it("switches into the tenant the link belongs to", async () => {
    const { call, recorded } = build({ linkClaimed: OTHER_ORG });

    await expect(call("acceptInvitationLink", { token: "tok" })).resolves.toEqual({
      organizationId: OTHER_ORG,
    });
    expect(recorded.sessions).toEqual([
      { token: "session-token", activeOrganizationId: OTHER_ORG },
    ]);
  });
});

describe("OrganizationPlugin — rebind", () => {
  // A cookie written over a session row that was not updated is a browser holding a
  // tenant the server does not agree with, until the cache entry expires.
  it("writes no cookie when the session row could not be updated", async () => {
    const { call } = build({ sessionUpdated: false });

    await expect(call("switchOrganization", { organizationId: ORG })).rejects.toThrow();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });
});
