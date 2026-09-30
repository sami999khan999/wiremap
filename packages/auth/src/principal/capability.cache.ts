import {
  type CacheStore,
  type CapabilityRepository,
  CapabilitySet,
  type CapabilitySetDto,
  type OrganizationId,
  type PlatformReader,
  type UserId,
} from "../import.js";

// `resolveFor` is four queries and runs on essentially every request. Fine at ten users,
// not at five hundred.
export class CapabilityCache {
  private static readonly PREFIX = "capability:user:";

  // Its own prefix, because the answer is keyed on the user alone: a platform admin holds
  // the same platform rights whichever tenant their session is pointed at.
  private static readonly PLATFORM_PREFIX = "capability:platform:";

  // A backstop for a forgotten invalidation, not the mechanism, and a revocation window
  // rather than a hit-rate dial. See docs/reference/capability-cache.md.
  private static readonly TTL_SECONDS = 60;

  // How long after an invalidation it is repeated. Longer than any read-through takes,
  // which is one indexed query; far shorter than the minute the stale set would live.
  private static readonly REPEAT_MS = 2_000;

  public constructor(
    private readonly repository: CapabilityRepository,
    private readonly cache: CacheStore,
    // Read on invalidation, not on resolution: flushing a tenant has to flush the third
    // axis too when that tenant *is* the tier, and nothing else knows which one it is.
    private readonly platform: PlatformReader,
  ) {}

  public async forUser(organizationId: OrganizationId, userId: UserId): Promise<CapabilitySet> {
    const key = CapabilityCache.keyFor(organizationId, userId);

    const cached = await this.cache.get<CapabilitySetDto>(key);
    if (cached) return CapabilitySet.from(cached);

    const resolved = await this.repository.resolveFor(organizationId, userId);
    await this.cache.set(key, resolved.toJSON(), CapabilityCache.TTL_SECONDS);
    return resolved;
  }

  // The same read-through, keyed on the user. The set it returns carries only the
  // platform axis; `PrincipalBuilder` merges it into the tenant one.
  public async platformFor(userId: UserId): Promise<CapabilitySet> {
    const key = `${CapabilityCache.PLATFORM_PREFIX}${userId}`;

    const cached = await this.cache.get<CapabilitySetDto>(key);
    if (cached) return CapabilitySet.from(cached);

    const resolved = await this.repository.resolvePlatformFor(userId);
    await this.cache.set(key, resolved.toJSON(), CapabilityCache.TTL_SECONDS);
    return resolved;
  }

  // Called on every RBAC write. Stale in this direction means a revoked permission keeps
  // working — a security bug wearing a caching bug's clothes.
  public async invalidate(organizationId: OrganizationId, userId: UserId): Promise<void> {
    const key = CapabilityCache.keyFor(organizationId, userId);
    await this.cache.delete(key);
    this.repeat(() => this.cache.delete(key));
    if (await this.isPlatform(organizationId)) await this.invalidatePlatform();
  }

  // A role edit affects everyone holding it, and the holders are not known here —
  // cheaper to flush the tenant than to enumerate them, and never wider than one.
  public async invalidateOrganization(organizationId: OrganizationId): Promise<void> {
    const prefix = `${CapabilityCache.PREFIX}${organizationId}:`;
    await this.cache.deletePrefix(prefix);
    this.repeat(() => this.cache.deletePrefix(prefix));
    if (await this.isPlatform(organizationId)) await this.invalidatePlatform();
  }

  // Every user at once, which is right and is cheap: the tier has a handful of members,
  // and the entries for everyone else are empty sets that cost one query to rebuild.
  public async invalidatePlatform(): Promise<void> {
    await this.cache.deletePrefix(CapabilityCache.PLATFORM_PREFIX);
    this.repeat(() => this.cache.deletePrefix(CapabilityCache.PLATFORM_PREFIX));
  }

  // Every tenant entry, repeated like the rest. Rare — a plan edit or an incident — and a
  // flushed entry costs one resolution to rebuild. See docs/reference/capability-cache.md.
  public async invalidateAll(): Promise<void> {
    await this.cache.deletePrefix(CapabilityCache.PREFIX);
    this.repeat(() => this.cache.deletePrefix(CapabilityCache.PREFIX));
  }

  // `CR.9`. A read-through that queried before the revoke committed can `SET` after the
  // delete, and the revoked set is served for a minute. The repeat removes what it wrote.
  private repeat(work: () => Promise<void>): void {
    setTimeout(() => {
      // Best effort: the TTL is still the backstop, and nobody is waiting on this.
      work().catch(() => undefined);
    }, CapabilityCache.REPEAT_MS).unref();
  }

  // The whole rule the use-cases would otherwise each have to carry: a role edit in a
  // customer tenant cannot change a platform grant, and one in the tier always can.
  private async isPlatform(organizationId: OrganizationId): Promise<boolean> {
    return organizationId === (await this.platform.organizationId());
  }

  // The organization sits between prefix and user id: in the key or a user in two of them
  // gets whichever set cached first, and in that position or `deletePrefix` breaks.
  private static keyFor(organizationId: OrganizationId, userId: UserId): string {
    return `${CapabilityCache.PREFIX}${organizationId}:${userId}`;
  }
}
