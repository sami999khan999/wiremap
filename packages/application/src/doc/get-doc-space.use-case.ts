import { type DocSpaceDto, type DocSpaceRefInput, NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

export class GetDocSpaceUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
  ) {}

  public async execute(actor: Principal, input: DocSpaceRefInput): Promise<DocSpaceDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const space = await this.spaces.findById(actor.organizationId, input.spaceId);
    if (!space) throw new NotFoundError("doc.space", input.spaceId);
    return DocShape.space(space);
  }
}
