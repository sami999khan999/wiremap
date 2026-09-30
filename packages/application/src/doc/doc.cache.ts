import { NotFoundError, type OrganizationId } from "../import.js";
import type { CacheStore } from "../port/index.js";
import { DocRules } from "./doc.rules.js";
import type { DocPagePublishedRecord, DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceRecord, DocSpaceRepository } from "./doc-space.repository.js";

// JSON has no dates, so the cached shapes carry strings and are revived on the way out.
type Cached<T, K extends keyof T> = Omit<T, K> & { readonly [P in K]: string };
type CachedSpace = Cached<DocSpaceRecord, "updatedAt">;
type CachedPage = Cached<DocPagePublishedRecord, "publishedAt">;

export interface DocReading {
  readonly space: DocSpaceRecord;
  readonly page: DocPagePublishedRecord | null;
}

// The read path, cached so that a warm page is zero queries. The page key names its
// revision, so it never goes stale: a publish makes a new key rather than editing one.
export class DocCache {
  // Short, and deleted after every commit that changes the space. The TTL is only the
  // bound on a delete that was lost.
  private static readonly SPACE_TTL_SECONDS = 60;
  // Immutable, so this is only how long an unread page occupies memory. Redis evicts
  // least-recently-used first anyway.
  private static readonly PAGE_TTL_SECONDS = 86_400;

  public constructor(
    private readonly cache: CacheStore,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
  ) {}

  // The space, its published tree and the page at `path`. A path that names nothing is
  // `NOT_FOUND`; a space with nothing published yet is a null page, not an error.
  public async read(
    organizationId: OrganizationId,
    slug: string,
    path: string,
  ): Promise<DocReading> {
    const space = await this.space(organizationId, slug);
    if (!space) throw new NotFoundError("doc.space", slug);
    return this.readIn(space, path);
  }

  // The same, for a caller that already holds the space — the platform's read path, which
  // has to look at its audience before it may look at a page.
  public async readIn(space: DocSpaceRecord, path: string): Promise<DocReading> {
    const node = DocRules.find(space.nav, path);
    if (!node || node.revisionNo === null) {
      if (path.length === 0) return { space, page: null };
      throw new NotFoundError("doc.page", path);
    }

    const page = await this.page(space.organizationId, node.id, node.revisionNo);
    if (!page) throw new NotFoundError("doc.page", path);
    return { space, page };
  }

  public async space(organizationId: OrganizationId, slug: string): Promise<DocSpaceRecord | null> {
    const key = DocCache.spaceKey(organizationId, slug);
    const cached = await this.cache.get<CachedSpace>(key);
    if (cached) return { ...cached, updatedAt: new Date(cached.updatedAt) };

    const space = await this.spaces.findBySlug(organizationId, slug);
    if (space) {
      await this.cache.set<CachedSpace>(
        key,
        { ...space, updatedAt: space.updatedAt.toISOString() },
        DocCache.SPACE_TTL_SECONDS,
      );
    }
    return space;
  }

  // After the commit that changed the space, never inside it: a reader between the delete
  // and the commit would put the old row straight back.
  public async forget(organizationId: OrganizationId, ...slugs: readonly string[]): Promise<void> {
    await Promise.all(
      slugs.map((slug) => this.cache.delete(DocCache.spaceKey(organizationId, slug))),
    );
  }

  private async page(
    organizationId: OrganizationId,
    pageId: DocPagePublishedRecord["id"],
    revisionNo: number,
  ): Promise<DocPagePublishedRecord | null> {
    const key = `doc:page:${organizationId}:${pageId}:${revisionNo}`;
    const cached = await this.cache.get<CachedPage>(key);
    if (cached) return { ...cached, publishedAt: new Date(cached.publishedAt) };

    const page = await this.pages.findPublished(organizationId, pageId);
    // A tree read just before a newer publish names the older revision. Serve what is
    // there, but never file it under a revision number it is not.
    if (page && page.revisionNo === revisionNo) {
      await this.cache.set<CachedPage>(
        key,
        { ...page, publishedAt: page.publishedAt.toISOString() },
        DocCache.PAGE_TTL_SECONDS,
      );
    }
    return page;
  }

  private static spaceKey(organizationId: OrganizationId, slug: string): string {
    return `doc:space:${organizationId}:${slug}`;
  }
}
