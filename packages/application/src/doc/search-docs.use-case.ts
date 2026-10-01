import type { DocSearchHitsDto, SearchDocsInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocFeaturePolicy } from "./doc-feature.policy.js";
import type { DocSearch } from "./doc-search.js";

// The Ctrl K palette's full-text half, over the actor's own organization's docs.
export class SearchDocsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocCache,
    private readonly search: DocSearch,
    private readonly features: DocFeaturePolicy,
  ) {}

  public async execute(actor: Principal, input: SearchDocsInput): Promise<DocSearchHitsDto> {
    this.authorizer.assert(actor, "doc.page.read");
    // Filtered before the search ranks anything, so another author's `owner` space can
    // neither appear nor move where the visible hits land.
    const scope = this.features.scope(actor);
    const spaces = [];
    for (const space of await this.spaces.list(actor.organizationId)) {
      if (!DocRules.isVisible(space, actor.userId)) continue;
      if (await this.features.allows(scope, space.access)) spaces.push(space);
    }
    return {
      items: await this.search.run(actor.organizationId, input.query, spaces, input.limit, scope),
    };
  }
}
