import { type FlagKey, FlagRegistry, NotFoundError, type OrganizationId } from "../import.js";
import type { CacheStore } from "../port/index.js";
import type { Principal } from "../primitive/index.js";
import type { FlagRepository } from "./flag.repository.js";

// What the cache holds: each flag and the org ids it targets, and nothing a check skips.
type FlagState = readonly {
  readonly key: string;
  readonly isEnabled: boolean;
  readonly organizationIds: readonly OrganizationId[];
}[];

// Whether a flag is on for an org, read on every document request by `fetchSession`. One
// key for the whole deployment, so every request after the first is one cache read.
export class FlagCache {
  private static readonly KEY = "flag:state";

  // The same revocation window as capabilities: a flag switched off is off within a minute
  // even if the delete below is lost. See docs/reference/authorizer.md.
  private static readonly TTL_SECONDS = 60;

  public constructor(
    private readonly repository: FlagRepository,
    private readonly cache: CacheStore,
  ) {}

  // Every declared flag that is on for the deployment or for this org. A row naming a
  // flag the code no longer declares is ignored, not trusted.
  public async onFor(organizationId: OrganizationId): Promise<readonly FlagKey[]> {
    const registry = FlagRegistry.instance;
    return (await this.state()).flatMap((row) =>
      registry.isKnown(row.key) && (row.isEnabled || row.organizationIds.includes(organizationId))
        ? [row.key]
        : [],
    );
  }

  public async isOn(organizationId: OrganizationId, key: FlagKey): Promise<boolean> {
    return (await this.onFor(organizationId)).includes(key);
  }

  // Before the permission check: a feature that does not exist yet for this org is not a
  // feature the caller lacks a key for. The error names no flag — its JSON reaches the browser.
  public async assertOn(actor: Principal, key: FlagKey): Promise<void> {
    if (!(await this.isOn(actor.organizationId, key))) {
      throw new NotFoundError("feature", "unavailable");
    }
  }

  // After every flag write commits. One delete, not the capability cache's two: a read
  // racing it can restore the old state for at most the TTL, which is the promise anyway.
  public async invalidate(): Promise<void> {
    await this.cache.delete(FlagCache.KEY);
  }

  private async state(): Promise<FlagState> {
    const cached = await this.cache.get<FlagState>(FlagCache.KEY);
    if (cached) return cached;

    const rows: FlagState = (await this.repository.findAll()).map(
      ({ key, isEnabled, targets }) => ({
        key,
        isEnabled,
        organizationIds: targets.map((target) => target.organizationId),
      }),
    );
    await this.cache.set(FlagCache.KEY, rows, FlagCache.TTL_SECONDS);
    return rows;
  }
}
