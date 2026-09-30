import { type DocPageDraftDto, type DocPageRefInput, NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import { DocShape } from "./doc-shape.js";

// The draft, for the editor. A reader never comes here: they read the published snapshot.
export class GetDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly pages: DocPageRepository,
  ) {}

  public async execute(actor: Principal, input: DocPageRefInput): Promise<DocPageDraftDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const page = await this.pages.findDraft(actor.organizationId, input.pageId);
    if (!page) throw new NotFoundError("doc.page", input.pageId);
    return DocShape.draft(page);
  }
}
