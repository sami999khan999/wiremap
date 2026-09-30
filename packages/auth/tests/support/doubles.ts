import type {
  ApiKeyPage,
  ApiKeyRecord,
  ApiKeyRepository,
  ApiKeySummary,
  CacheStore,
  CapabilityExplanation,
  CapabilityRepository,
  PlatformOrganization,
  PlatformReader,
} from "@loadbearing/application";
import type { ApiKeyId, OrganizationId, UserId } from "@loadbearing/contracts";
import { CapabilitySet, EntitlementMask } from "@loadbearing/permissions";
import type { RequestHeaders, ResolvedSession, SessionResolver } from "../../src/import.js";

// Hand-written rather than `composition`'s fakes, which would close a cycle. Each
// records what it was asked: the behaviours here are about which call happened, in order.

export class RecordingCapabilityRepository implements CapabilityRepository {
  public readonly calls: { organizationId: string; userId: string }[] = [];
  public readonly platformCalls: string[] = [];

  public constructor(
    private readonly sets: ReadonlyMap<string, CapabilitySet>,
    // Keyed on the user alone, like the resolution it stands in for. Empty by default,
    // so a spec that is not about the tier does not have to stage one.
    private readonly platformSets: ReadonlyMap<string, CapabilitySet> = new Map(),
  ) {}

  public resolveFor(organizationId: OrganizationId, userId: UserId): Promise<CapabilitySet> {
    this.calls.push({ organizationId, userId });
    const set = this.sets.get(`${organizationId}:${userId}`);
    if (!set) throw new Error(`No capability set staged for ${organizationId}:${userId}`);
    return Promise.resolve(set);
  }

  // Never asked here: the builder and the cache only resolve.
  public explainFor(): Promise<CapabilityExplanation> {
    throw new Error("explainFor is the inspector's, not under test here");
  }

  // Unlimited: these specs are about caching and credentials, not about plans.
  public entitlementFor(): Promise<EntitlementMask> {
    return Promise.resolve(
      EntitlementMask.from({ plan: "all", added: [], removed: [], disabledModules: [] }),
    );
  }

  public resolvePlatformFor(userId: UserId): Promise<CapabilitySet> {
    this.platformCalls.push(userId);
    return Promise.resolve(this.platformSets.get(userId) ?? CapabilitySet.empty());
  }
}

// The tier's own id, so `CapabilityCache` can tell "flush a tenant" from "flush the
// tier". A spec that names no platform organization gets one nothing else uses.
export class StubPlatformReader implements PlatformReader {
  public constructor(
    private readonly id: OrganizationId = "018f8c00-0000-7000-8000-0000000000ff" as OrganizationId,
  ) {}

  public organizationId(): Promise<OrganizationId> {
    return Promise.resolve(this.id);
  }

  public organization(): Promise<PlatformOrganization> {
    return Promise.resolve({ id: this.id, slug: "platform", name: "Platform" });
  }
}

// A real map, so a spec can assert on the key rather than on a mock's call log. The key
// layout *is* the behaviour under test in `CapabilityCache`.
export class MapCacheStore implements CacheStore {
  public readonly entries = new Map<string, unknown>();

  public get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.entries.get(key) as T | undefined) ?? null);
  }

  public set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }

  public setIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.entries.has(key)) return Promise.resolve(false);
    this.entries.set(key, value);
    return Promise.resolve(true);
  }

  public delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  public deletePrefix(prefix: string): Promise<void> {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
    return Promise.resolve();
  }
}

// Every staged record regardless of prefix, deliberately: the resolver must not trust
// the narrowing, because the hash comparison is what decides.
export class StubApiKeyRepository implements ApiKeyRepository {
  public readonly prefixes: string[] = [];
  public readonly touched: { id: string; at: Date }[] = [];

  public constructor(private readonly records: readonly ApiKeyRecord[]) {}

  public findByPrefix(prefix: string): Promise<readonly ApiKeyRecord[]> {
    this.prefixes.push(prefix);
    return Promise.resolve(this.records);
  }

  public touch(id: ApiKeyId, at: Date): Promise<void> {
    this.touched.push({ id, at });
    return Promise.resolve();
  }

  public listByOrganization(): Promise<ApiKeyPage> {
    throw new Error("not under test");
  }

  public findById(): Promise<ApiKeySummary | null> {
    throw new Error("not under test");
  }

  public create(): Promise<void> {
    throw new Error("not under test");
  }

  public revoke(): Promise<void> {
    throw new Error("not under test");
  }
}

export class StubSessionResolver implements SessionResolver {
  public calls = 0;

  public constructor(private readonly session: ResolvedSession | null) {}

  public resolve(_headers: RequestHeaders): Promise<ResolvedSession | null> {
    this.calls += 1;
    return Promise.resolve(this.session);
  }
}

// The narrowest thing `RequestHeaders` accepts. A real `Headers` would work too; a plain
// lookup keeps these specs free of a DOM lib this package does not otherwise need.
export function headers(values: Readonly<Record<string, string>> = {}): RequestHeaders {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}
