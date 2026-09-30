import type { DocSearchHitDto, OrganizationId } from "../import.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceSummary } from "./doc-space.repository.js";

// Matches from the index, resolved to the paths a reader opens. Shared by the tenant's search
// and the platform's, which differ only in which spaces they may show.
export class DocSearch {
  public constructor(
    private readonly pages: DocPageRepository,
    private readonly cache: DocCache,
  ) {}

  // `spaces` is what the caller may show; a match outside it is dropped. Twice the limit is
  // asked for, so a caller with most spaces filtered out still gets a page of results.
  public async run(
    organizationId: OrganizationId,
    query: string,
    spaces: readonly DocSpaceSummary[],
    limit: number,
  ): Promise<DocSearchHitDto[]> {
    const allowed = new Map(spaces.map((space) => [space.id, space]));
    if (allowed.size === 0) return [];

    const matches = await this.pages.search(organizationId, query, limit * 2);
    const hits: DocSearchHitDto[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      const summary = allowed.get(match.spaceId);
      if (!summary) continue;
      // The tree, from the same cache the reader uses. A page it no longer holds was
      // unpublished or moved after the match was indexed, and is not shown.
      const space = await this.cache.space(organizationId, summary.slug);
      const node = space ? DocRules.locate(space.nav, match.pageId) : null;
      if (!node?.path) continue;

      const key = `${match.pageId}#${match.anchor ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hits.push({
        pageId: match.pageId,
        spaceSlug: summary.slug,
        spaceTitle: summary.title,
        path: node.path,
        title: node.title,
        heading: match.heading === node.title ? null : match.heading,
        anchor: match.anchor,
        excerpt: match.excerpt,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}
