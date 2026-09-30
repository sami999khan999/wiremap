import type { DocSpaceListDto } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// The actor's own organization's spaces, every audience included: a member reads all of
// their organization's docs, and the audience only widens who else may.
export class ListDocSpacesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
  ) {}

  public async execute(actor: Principal): Promise<DocSpaceListDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const spaces = await this.spaces.list(actor.organizationId);
    return { items: spaces.map((space) => DocShape.space(space)) };
  }
}
