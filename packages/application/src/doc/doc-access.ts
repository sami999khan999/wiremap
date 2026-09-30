import type { DocSpaceId, OrganizationId } from "../import.js";
import type { CacheStore } from "../port/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocGrantRepository } from "./doc-grant.repository.js";
import type { DocSpaceSummary } from "./doc-space.repository.js";

// Who may read one of the platform organization's spaces from outside it. A permission is
// the answer inside an organization; for everyone else it is the audience and the grants.
export class DocAccess {
  // The same window as capabilities: a revoked grant stops working within a minute even
  // when the delete below is lost.
  private static readonly TTL_SECONDS = 60;
  private static readonly PREFIX = "doc:access:";

  public constructor(
    private readonly grants: DocGrantRepository,
    private readonly cache: CacheStore,
  ) {}

  // `members` spaces are the platform's own staff's, reached through `/doc` like any
  // tenant's. Everyone else answers NOT_FOUND, so a private slug cannot be probed.
  public async canRead(
    viewer: Principal | null,
    space: DocSpaceSummary,
    platformOrganizationId: OrganizationId,
  ): Promise<boolean> {
    if (space.audience === "public") return true;
    if (!viewer) return false;
    if (viewer.organizationId === platformOrganizationId && viewer.can("doc.page.read")) {
      return true;
    }
    if (space.audience !== "granted") return false;
    if (viewer.can("platform.doc.grant")) return true;
    return (await this.readable(viewer)).includes(space.id);
  }

  // After every grant write commits. Every viewer's set, because a plan's grant reaches
  // people nobody could list without reading every tenant.
  public async forget(): Promise<void> {
    await this.cache.deletePrefix(DocAccess.PREFIX);
  }

  private async readable(viewer: Principal): Promise<readonly DocSpaceId[]> {
    const key = `${DocAccess.PREFIX}${viewer.organizationId}:${viewer.userId}`;
    const cached = await this.cache.get<readonly DocSpaceId[]>(key);
    if (cached) return cached;

    const ids = await this.grants.readableSpaceIds(viewer.organizationId, viewer.userId);
    await this.cache.set(key, ids, DocAccess.TTL_SECONDS);
    return ids;
  }
}
