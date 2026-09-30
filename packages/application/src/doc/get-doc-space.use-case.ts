import type { DocSpaceDto, DocSpaceRefInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocRules } from "./doc.rules.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

export class GetDocSpaceUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
  ) {}

  public async execute(actor: Principal, input: DocSpaceRefInput): Promise<DocSpaceDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const space = DocRules.assertVisible(
      await this.spaces.findById(actor.organizationId, input.spaceId),
      actor.userId,
      "doc.space",
      input.spaceId,
    );
    return DocShape.space(space);
  }
}
