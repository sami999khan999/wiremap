import { Identifiers } from "@loadbearing/contracts";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityCache } from "../../src/principal/capability.cache.js";
import {
  MapCacheStore,
  RecordingCapabilityRepository,
  StubPlatformReader,
} from "../support/doubles.js";

const ORG_A = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000a1");
const ORG_B = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000b1");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const PLATFORM_ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000ff");

function holding(...grants: readonly PermissionKey[]): CapabilitySet {
  return CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} });
}

function cacheWith(
  sets: ReadonlyMap<string, CapabilitySet>,
  platformSets: ReadonlyMap<string, CapabilitySet> = new Map(),
) {
  const repository = new RecordingCapabilityRepository(sets, platformSets);
  const store = new MapCacheStore();
  const cache = new CapabilityCache(repository, store, new StubPlatformReader(PLATFORM_ORG));
  return { repository, store, cache };
}

describe("CapabilityCache", () => {
  it("asks the repository once and serves the second read from the cache", async () => {
    const { cache, repository } = cacheWith(
      new Map([[`${ORG_A}:${USER}`, holding("rbac.role.read")]]),
    );

    expect((await cache.forUser(ORG_A, USER)).can("rbac.role.read")).toBe(true);
    expect((await cache.forUser(ORG_A, USER)).can("rbac.role.read")).toBe(true);

    // `resolveFor` is three queries and runs on essentially every request. One call is
    // the entire reason this class exists.
    expect(repository.calls).toHaveLength(1);
  });

  it("keys on organization and user, so the same person in two tenants gets two answers", async () => {
    const { cache, repository } = cacheWith(
      new Map([
        [`${ORG_A}:${USER}`, holding("rbac.role.read", "rbac.role.manage")],
        [`${ORG_B}:${USER}`, holding("member.read")],
      ]),
    );

    const inA = await cache.forUser(ORG_A, USER);
    const inB = await cache.forUser(ORG_B, USER);

    // Keyed on the user alone, this person carries organization A's permissions into B —
    // a cross-tenant privilege bug with a one-minute fuse and no error anywhere.
    expect(inA.can("rbac.role.manage")).toBe(true);
    expect(inB.can("rbac.role.manage")).toBe(false);
    expect(inB.can("member.read")).toBe(true);
    expect(repository.calls).toHaveLength(2);
  });

  it("writes the organization between the fixed prefix and the user id", async () => {
    const { cache, store } = cacheWith(new Map([[`${ORG_A}:${USER}`, holding("member.read")]]));
    await cache.forUser(ORG_A, USER);

    // The position matters as much as the presence: `invalidateOrganization` deletes by
    // prefix, so the tenant has to sit between the fixed part and the user id.
    expect([...store.entries.keys()]).toEqual([`capability:user:${ORG_A}:${USER}`]);
  });

  it("drops one entry on invalidate and leaves the other tenant's alone", async () => {
    const { cache, store } = cacheWith(
      new Map([
        [`${ORG_A}:${USER}`, holding("member.read")],
        [`${ORG_B}:${USER}`, holding("member.read")],
      ]),
    );

    await cache.forUser(ORG_A, USER);
    await cache.forUser(ORG_B, USER);
    await cache.invalidate(ORG_A, USER);

    expect([...store.entries.keys()]).toEqual([`capability:user:${ORG_B}:${USER}`]);
  });

  it("flushes one tenant on invalidateOrganization and leaves the other standing", async () => {
    const { cache, store } = cacheWith(
      new Map([
        [`${ORG_A}:${USER}`, holding("member.read")],
        [`${ORG_B}:${USER}`, holding("member.read")],
      ]),
    );

    await cache.forUser(ORG_A, USER);
    await cache.forUser(ORG_B, USER);
    store.entries.set("unrelated:key", "kept");

    // A role edit affects everyone holding it — cheaper to flush than to enumerate. The
    // tenant in the prefix is what keeps the flush inside the organization that changed.
    await cache.invalidateOrganization(ORG_A);

    expect([...store.entries.keys()]).toEqual([
      `capability:user:${ORG_B}:${USER}`,
      "unrelated:key",
    ]);
  });

  // A plan edit or the kill switch changes every holder of a plan, and they are not known.
  // The platform axis stays: no plan reaches it, so there is nothing of it to flush.
  it("flushes every tenant on invalidateAll, and leaves the platform axis", async () => {
    const { cache, store } = cacheWith(
      new Map([
        [`${ORG_A}:${USER}`, holding("member.read")],
        [`${ORG_B}:${USER}`, holding("member.read")],
      ]),
    );

    await cache.forUser(ORG_A, USER);
    await cache.forUser(ORG_B, USER);
    await cache.platformFor(USER);

    await cache.invalidateAll();

    expect([...store.entries.keys()]).toEqual([`capability:platform:${USER}`]);
  });

  it("re-reads the repository after an invalidation", async () => {
    const { cache, repository } = cacheWith(
      new Map([[`${ORG_A}:${USER}`, holding("member.read")]]),
    );

    await cache.forUser(ORG_A, USER);
    await cache.invalidate(ORG_A, USER);
    await cache.forUser(ORG_A, USER);

    // Getting this wrong in the stale direction means a revoked permission keeps
    // working, which is a security bug wearing a caching bug's clothes.
    expect(repository.calls).toHaveLength(2);
  });
});

// The third axis. Keyed on the user alone, cached under its own prefix, and flushed by
// this class rather than by the use-cases — see docs/reference/capability-cache.md.
describe("CapabilityCache — the platform axis", () => {
  const admin = (...grants: readonly PermissionKey[]): CapabilitySet =>
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants, denies: [] },
    });

  it("caches under its own prefix, with no organization in the key", async () => {
    const { cache, store, repository } = cacheWith(
      new Map(),
      new Map([[USER, admin("platform.status.read")]]),
    );

    expect((await cache.platformFor(USER)).can("platform.status.read")).toBe(true);
    expect((await cache.platformFor(USER)).can("platform.status.read")).toBe(true);

    expect(repository.platformCalls).toEqual([USER]);
    expect([...store.entries.keys()]).toEqual([`capability:platform:${USER}`]);
  });

  // The rule that would otherwise have to live in four use-cases: only this class knows
  // which organization is the tier.
  it("flushes the axis when the tenant being flushed is the tier", async () => {
    const { cache, store } = cacheWith(new Map(), new Map([[USER, admin("platform.status.read")]]));
    await cache.platformFor(USER);

    await cache.invalidateOrganization(ORG_A);
    expect(store.entries.has(`capability:platform:${USER}`)).toBe(true);

    await cache.invalidateOrganization(PLATFORM_ORG);
    expect(store.entries.has(`capability:platform:${USER}`)).toBe(false);
  });

  // A role edit in a customer tenant must not be able to change a platform grant, and
  // this is the half of that sentence a cache can get wrong.
  it("leaves the axis alone when a member of a customer tenant is flushed", async () => {
    const { cache, store } = cacheWith(new Map(), new Map([[USER, admin("platform.status.read")]]));
    await cache.platformFor(USER);

    await cache.invalidate(ORG_B, USER);
    expect(store.entries.has(`capability:platform:${USER}`)).toBe(true);

    await cache.invalidate(PLATFORM_ORG, USER);
    expect(store.entries.has(`capability:platform:${USER}`)).toBe(false);
  });
});

// `CR.9`. A read-through that queried before the revoke committed wrote the old set back
// after the delete, and it was served for the rest of the minute.
describe("CapabilityCache — a fill racing the invalidation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes again a moment later, taking the late write with it", async () => {
    vi.useFakeTimers();
    const { cache, store } = cacheWith(new Map([[`${ORG_A}:${USER}`, holding("member.read")]]));
    const key = `capability:user:${ORG_A}:${USER}`;

    await cache.invalidate(ORG_A, USER);
    // The racing read-through landing after the first delete.
    await store.set(key, holding("member.read").toJSON());
    expect(store.entries.has(key)).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(store.entries.has(key)).toBe(false);
  });
});
