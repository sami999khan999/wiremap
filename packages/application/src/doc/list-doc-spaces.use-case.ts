import type { DocSpaceListDto } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocFeaturePolicy } from "./doc-feature.policy.js";
import { DocShape } from "./doc-shape.js";

// The actor's own organization's spaces: every audience but another author's `owner`
// space, which is the one audience that narrows who in the organization may read.
export class ListDocSpacesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocCache,
    private readonly features: DocFeaturePolicy,
  ) {}

  public async execute(actor: Principal): Promise<DocSpaceListDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const spaces = await this.spaces.list(actor.organizationId);
    const scope = this.features.scope(actor);
    const items = [];
    for (const space of spaces) {
      if (!DocRules.isVisible(space, actor.userId)) continue;
      if (await this.features.allows(scope, space.access)) items.push(DocShape.space(space));
    }
    return { items };
  }
}
