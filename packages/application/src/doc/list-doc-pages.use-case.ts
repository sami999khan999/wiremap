import type { DocPageTreeDto, ListDocPagesInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// The editor's tree: every page, drafts included, no bodies.
export class ListDocPagesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
  ) {}

  public async execute(actor: Principal, input: ListDocPagesInput): Promise<DocPageTreeDto> {
    this.authorizer.assert(actor, "doc.page.write");
    DocRules.assertVisible(
      await this.spaces.findById(actor.organizationId, input.spaceId),
      actor.userId,
      "doc.space",
      input.spaceId,
    );

    const nodes = await this.pages.listBySpace(actor.organizationId, input.spaceId);
    return { items: nodes.map((node) => DocShape.node(node)) };
  }
}
