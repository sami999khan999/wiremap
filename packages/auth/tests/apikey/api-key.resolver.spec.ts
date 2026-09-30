import type { ApiKeyRecord } from "@loadbearing/application";
import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { ApiKeyHasher } from "../../src/apikey/api-key.hasher.js";
import { ApiKeyResolver } from "../../src/apikey/api-key.resolver.js";
import { CapabilityCache } from "../../src/principal/capability.cache.js";
import { MembershipReader, type OrganizationSummary } from "../../src/session/index.js";
import {
  MapCacheStore,
  RecordingCapabilityRepository,
  StubApiKeyRepository,
  StubPlatformReader,
} from "../support/doubles.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ISSUER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const KEY_ID = Identifiers.apiKeyId.parse("018f8c00-0000-7000-8000-0000000000d1");

const TOKEN = "rk_1111111111111111111111111111111111111111111111111111111111111111";

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: KEY_ID,
    organizationId: ORG,
    issuerId: ISSUER,
    tokenHash: "",
    scopes: ["rbac.role.read", "rbac.role.manage"],
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function issuerHolding(...grants: readonly PermissionKey[]): CapabilitySet {
  return CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} });
}

// Only `isActive` is asked: the issuer's membership, the check the session path makes.
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

function resolverFor(records: readonly ApiKeyRecord[], issuer: CapabilitySet, active = true) {
  const repository = new StubApiKeyRepository(records);
  const capabilities = new CapabilityCache(
    new RecordingCapabilityRepository(new Map([[`${ORG}:${ISSUER}`, issuer]])),
    new MapCacheStore(),
    new StubPlatformReader(),
  );

  return {
    repository,
    resolver: new ApiKeyResolver(repository, capabilities, new StubMemberships(active)),
  };
}

describe("ApiKeyResolver", () => {
  it("resolves a live key to a principal scoped to the intersection", async () => {
    const hash = await ApiKeyHasher.hash(TOKEN);
    const { resolver, repository } = resolverFor(
      [record({ tokenHash: hash })],
      issuerHolding("rbac.role.read", "rbac.role.manage", "member.read"),
    );

    const principal = await resolver.resolve(TOKEN);

    expect(principal?.kind).toBe("api_key");
    expect(principal?.organizationId).toBe(ORG);
    // The key declared two scopes and the issuer holds three. The principal gets the two
    // — never the issuer's third, which the key never asked for.
    expect(principal?.can("rbac.role.read")).toBe(true);
    expect(principal?.can("rbac.role.manage")).toBe(true);
    expect(principal?.can("member.read")).toBe(false);
    expect(repository.touched).toEqual([{ id: KEY_ID, at: expect.any(Date) }]);
  });

  it("re-intersects with the issuer's live capabilities rather than the scopes frozen at creation", async () => {
    const hash = await ApiKeyHasher.hash(TOKEN);
    // The key still declares `rbac.role.manage`. The issuer has since lost it.
    const { resolver } = resolverFor(
      [record({ tokenHash: hash })],
      issuerHolding("rbac.role.read"),
    );

    const principal = await resolver.resolve(TOKEN);

    // What the class exists for: revoking a person narrows every key they issued, in the
    // same request. Frozen scopes would keep working and report nothing.
    expect(principal?.can("rbac.role.read")).toBe(true);
    expect(principal?.can("rbac.role.manage")).toBe(false);
  });

  it("drops a scope the permission registry does not know", async () => {
    const hash = await ApiKeyHasher.hash(TOKEN);
    const { resolver } = resolverFor(
      [record({ tokenHash: hash, scopes: ["rbac.role.read", "finance.invent.everything"] })],
      issuerHolding("rbac.role.read"),
    );

    const principal = await resolver.resolve(TOKEN);

    expect(principal?.can("rbac.role.read")).toBe(true);
    // A row written before a permission was renamed, or by hand. It cannot become a
    // grant of anything, and it must not throw either — a stale key is a 401, not a 500.
    expect(principal?.capabilities.toJSON().org.grants).toEqual(["rbac.role.read"]);
  });

  // `CR.2`. A fired employee's key kept working, because only the session path checked
  // the membership — and `core` keys survive any intersection with an emptied issuer.
  it("refuses a key whose issuer's membership is deactivated", async () => {
    const hash = await ApiKeyHasher.hash(TOKEN);
    const { resolver } = resolverFor(
      [record({ tokenHash: hash })],
      issuerHolding("rbac.role.read", "rbac.role.manage"),
      false,
    );

    expect(await resolver.resolve(TOKEN)).toBeNull();
  });

  it("refuses a revoked key", async () => {
    const hash = await ApiKeyHasher.hash(TOKEN);
    const { resolver, repository } = resolverFor(
      [record({ tokenHash: hash, revokedAt: new Date("2026-01-01T00:00:00Z") })],
      issuerHolding("rbac.role.read"),
    );

    expect(await resolver.resolve(TOKEN)).toBeNull();
    // And does not record a use for a credential it refused.
    expect(repository.touched).toEqual([]);
  });

  it("refuses an expired key and accepts one expiring in the future", async () => {
    const hash = await ApiKeyHasher.hash(TOKEN);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);

    const expired = resolverFor(
      [record({ tokenHash: hash, expiresAt: past })],
      issuerHolding("rbac.role.read"),
    );
    expect(await expired.resolver.resolve(TOKEN)).toBeNull();

    const live = resolverFor(
      [record({ tokenHash: hash, expiresAt: future })],
      issuerHolding("rbac.role.read"),
    );
    expect(await live.resolver.resolve(TOKEN)).not.toBeNull();
  });

  it("refuses a token whose hash matches nothing the prefix returned", async () => {
    // Several keys share a prefix. Returning the first candidate rather than comparing
    // hashes would authenticate one integration as another.
    const { resolver } = resolverFor(
      [record({ tokenHash: await ApiKeyHasher.hash("rk_someothertoken") })],
      issuerHolding("rbac.role.read"),
    );

    expect(await resolver.resolve(TOKEN)).toBeNull();
  });
});
