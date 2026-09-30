import { type DocPageRefInput, type DocRevisionListDto, NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// Newest first. Summaries only: a page published two hundred times is two hundred bodies
// nobody asked for.
export class ListDocRevisionsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly pages: DocPageRepository,
    private readonly spaces: DocSpaceRepository,
  ) {}

  public async execute(actor: Principal, input: DocPageRefInput): Promise<DocRevisionListDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const page = await this.pages.findDraft(actor.organizationId, input.pageId);
    if (!page) throw new NotFoundError("doc.page", input.pageId);
    DocRules.assertVisible(
      await this.spaces.findById(actor.organizationId, page.spaceId),
      actor.userId,
      "doc.page",
      input.pageId,
    );
    return { items: await this.pages.listRevisions(actor.organizationId, input.pageId) };
  }
}
