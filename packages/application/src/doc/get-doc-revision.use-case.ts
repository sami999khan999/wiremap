import { type DocRevisionDto, type DocRevisionRefInput, NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

export class GetDocRevisionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly pages: DocPageRepository,
    private readonly spaces: DocSpaceRepository,
  ) {}

  public async execute(actor: Principal, input: DocRevisionRefInput): Promise<DocRevisionDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const page = await this.pages.findDraft(actor.organizationId, input.pageId);
    if (!page) throw new NotFoundError("doc.page", input.pageId);
    DocRules.assertVisible(
      await this.spaces.findById(actor.organizationId, page.spaceId),
      actor.userId,
      "doc.page",
      input.pageId,
    );
    const revision = await this.pages.findRevision(
      actor.organizationId,
      input.pageId,
      input.revisionNo,
    );
    if (!revision) throw new NotFoundError("doc.revision", `${input.pageId}:${input.revisionNo}`);
    return revision;
  }
}
