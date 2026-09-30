import type { DocSpaceListDto } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocRules } from "./doc.rules.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// The actor's own organization's spaces: every audience but another author's `owner`
// space, which is the one audience that narrows who in the organization may read.
export class ListDocSpacesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
  ) {}

  public async execute(actor: Principal): Promise<DocSpaceListDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const spaces = await this.spaces.list(actor.organizationId);
    return {
      items: spaces
        .filter((space) => DocRules.isVisible(space, actor.userId))
        .map((space) => DocShape.space(space)),
    };
  }
}
