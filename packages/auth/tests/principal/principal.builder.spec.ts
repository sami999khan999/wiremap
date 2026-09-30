import { type ApiKeyRecord, Principal } from "@loadbearing/application";
import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { ApiKeyHasher } from "../../src/apikey/api-key.hasher.js";
import { ApiKeyResolver } from "../../src/apikey/api-key.resolver.js";
import { CapabilityCache } from "../../src/principal/capability.cache.js";
import { PrincipalBuilder } from "../../src/principal/principal.builder.js";
import { MembershipReader, type OrganizationSummary } from "../../src/session/index.js";
import {
  headers,
  MapCacheStore,
  RecordingCapabilityRepository,
  StubApiKeyRepository,
  StubPlatformReader,
  StubSessionResolver,
} from "../support/doubles.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const COOKIE_USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const KEY_ISSUER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");

const TOKEN = "rk_2222222222222222222222222222222222222222222222222222222222222222";

function holding(...grants: readonly PermissionKey[]): CapabilitySet {
  return CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} });
}

// A deactivated membership is the one case where a valid session must not produce a
// principal, so the double answers the question rather than the whole reader.
class StubMemberships extends MembershipReader {
  public constructor(private readonly active: boolean) {
    super();
  }

  public override activeOrganizationFor(): Promise<OrganizationId | null> {
    return Promise.resolve(ORG);
  }

  public override organizationsFor(): Promise<readonly OrganizationSummary[]> {
    return Promise.resolve([]);
  }

  public override isActive(): Promise<boolean> {
    return Promise.resolve(this.active);
  }

  public override ownedCount(): Promise<number> {
    return Promise.resolve(0);
  }

  public override isSuspended(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

async function build(options: {
  readonly session: boolean;
  readonly keys?: readonly ApiKeyRecord[];
  readonly active?: boolean;
  // The third axis, resolved per user. Absent by default, which is every user but a
  // handful in any deployment.
  readonly platform?: readonly PermissionKey[];
}) {
  const sessions = new StubSessionResolver(
    options.session
      ? {
          organizationId: ORG,
          userId: COOKIE_USER,
          sessionId: "session-1",
          expiresAt: new Date(Date.now() + 3_600_000),
        }
      : null,
  );

  const capabilities = new CapabilityCache(
    new RecordingCapabilityRepository(
      new Map([
        // The cookie holds everything; the key's issuer holds one permission. That gap
        // is what makes "which credential won" observable.
        [`${ORG}:${COOKIE_USER}`, holding("rbac.role.read", "rbac.role.manage", "member.read")],
        [`${ORG}:${KEY_ISSUER}`, holding("member.read")],
      ]),
      new Map(
        options.platform
          ? [
              [
                COOKIE_USER,
                CapabilitySet.from({
                  wildcard: false,
                  org: { grants: [], denies: [] },
                  goals: {},
                  platform: { grants: options.platform, denies: [] },
                }),
              ],
            ]
          : [],
      ),
    ),
    new MapCacheStore(),
    new StubPlatformReader(),
  );

  const keyRepository = new StubApiKeyRepository(options.keys ?? []);
  const memberships = new StubMemberships(options.active ?? true);
  const builder = new PrincipalBuilder(
    sessions,
    new ApiKeyResolver(keyRepository, capabilities, memberships),
    capabilities,
    memberships,
  );

  return { builder, sessions, keyRepository };
}

async function keyRecord(): Promise<ApiKeyRecord> {
  return {
    id: Identifiers.apiKeyId.parse("018f8c00-0000-7000-8000-0000000000d1"),
    organizationId: ORG,
    issuerId: KEY_ISSUER,
    tokenHash: await ApiKeyHasher.hash(TOKEN),
    scopes: ["member.read"],
    expiresAt: null,
    revokedAt: null,
  };
}

describe("PrincipalBuilder", () => {
  it("builds a user principal from a session", async () => {
    const { builder } = await build({ session: true });

    const principal = await builder.fromHeaders(headers());

    expect(principal?.kind).toBe("user");
    expect(principal?.userId).toBe(COOKIE_USER);
    expect(principal?.can("rbac.role.manage")).toBe(true);
  });

  // The whole point of deactivating someone: their cookie is still valid, still
  // decrypts, and still names a real organization. Nothing else refuses it.
  it("returns null for a valid session whose membership is deactivated", async () => {
    const { builder } = await build({ session: true, active: false });

    expect(await builder.fromHeaders(headers())).toBeNull();
  });

  it("returns null when there is no credential of any kind", async () => {
    const { builder } = await build({ session: false });

    expect(await builder.fromHeaders(headers())).toBeNull();
  });

  it("checks the api key before the cookie when a request carries both", async () => {
    const { builder, sessions } = await build({ session: true, keys: [await keyRecord()] });

    const principal = await builder.fromHeaders(headers({ "x-api-key": TOKEN }));

    // An integration calling from a browser sends both. Session-first would upgrade a key
    // scoped to `member.read` to the user's full permissions.
    expect(principal?.kind).toBe("api_key");
    expect(principal?.userId).toBe(KEY_ISSUER);
    expect(principal?.can("member.read")).toBe(true);
    expect(principal?.can("rbac.role.manage")).toBe(false);
    // And the session is never even resolved, so the cookie cannot influence the answer.
    expect(sessions.calls).toBe(0);
  });

  it("does not fall back to the cookie when the api key is rejected", async () => {
    const revoked = { ...(await keyRecord()), revokedAt: new Date("2026-01-01T00:00:00Z") };
    const { builder } = await build({ session: true, keys: [revoked] });

    // Falling through to the session here would turn a revoked integration key into a
    // working request whenever the caller happened to also hold a browser session.
    expect(await builder.fromHeaders(headers({ "x-api-key": TOKEN }))).toBeNull();
  });
});

// Merged rather than chosen between. The session is pointed at a customer tenant
// throughout — `ORG` is not the tier — which is the case worth pinning.
describe("PrincipalBuilder — the platform axis", () => {
  it("carries a platform key into a principal whose active tenant is a customer one", async () => {
    const { builder } = await build({ session: true, platform: ["platform.status.read"] });

    const principal = await builder.fromHeaders(headers());

    expect(principal?.organizationId).toBe(ORG);
    expect(principal?.can("platform.status.read")).toBe(true);
    // And the tenant axis survived the merge, which a naive overwrite would have lost.
    expect(principal?.can("rbac.role.manage")).toBe(true);
  });

  it("gives a user with no membership in the tier nothing on that axis", async () => {
    const { builder } = await build({ session: true });

    expect((await builder.fromHeaders(headers()))?.can("platform.status.read")).toBe(false);
  });

  // The leak that matters most here: a key issued by a platform admin must not act as
  // one, because revoking it means finding a key rather than removing a membership.
  it("empties the axis on the API-key path", async () => {
    const { builder } = await build({
      session: true,
      keys: [await keyRecord()],
      platform: ["platform.status.read"],
    });

    const principal = await builder.fromHeaders(headers({ "x-api-key": TOKEN }));

    expect(principal?.kind).toBe("api_key");
    expect(principal?.can("platform.status.read")).toBe(false);
  });
});

// What a held stream re-reads each minute. A principal captured at open keeps every right
// it had, so a deactivation or a revoked key would never reach the stream (`RV.1`).
describe("PrincipalBuilder.refresh", () => {
  it("rebuilds a user principal from the current capabilities", async () => {
    const { builder } = await build({ session: true });
    const stale = new Principal(ORG, COOKIE_USER, holding("doc.page.write"));

    const fresh = await builder.refresh(stale);

    expect(fresh?.kind).toBe("user");
    expect(fresh?.can("rbac.role.manage")).toBe(true);
    expect(fresh?.can("doc.page.write")).toBe(false);
  });

  it("returns null for a user whose membership was deactivated", async () => {
    const { builder } = await build({ session: true, active: false });

    expect(
      await builder.refresh(new Principal(ORG, COOKIE_USER, holding("member.read"))),
    ).toBeNull();
  });

  // The declared scopes are not in hand, so the old set is narrowed by the issuer's fresh
  // one. Rebuilding from the issuer alone would widen a key to everything they hold.
  it("narrows an api key by its issuer and never widens it", async () => {
    const { builder } = await build({ session: true });
    const key = Principal.apiKey(ORG, COOKIE_USER, holding("member.read"));

    const fresh = await builder.refresh(key);

    expect(fresh?.kind).toBe("api_key");
    expect(fresh?.can("member.read")).toBe(true);
    expect(fresh?.can("rbac.role.manage")).toBe(false);
  });

  it("returns null for an api key whose issuer was deactivated", async () => {
    const { builder } = await build({ session: true, active: false });

    expect(
      await builder.refresh(Principal.apiKey(ORG, KEY_ISSUER, holding("member.read"))),
    ).toBeNull();
  });
});
