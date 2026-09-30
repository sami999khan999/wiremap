import type { DocPageRefInput, DocRevisionListDto } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocPageRepository } from "./doc-page.repository.js";

// Newest first. Summaries only: a page published two hundred times is two hundred bodies
// nobody asked for.
export class ListDocRevisionsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly pages: DocPageRepository,
  ) {}

  public async execute(actor: Principal, input: DocPageRefInput): Promise<DocRevisionListDto> {
    this.authorizer.assert(actor, "doc.page.write");
    return { items: await this.pages.listRevisions(actor.organizationId, input.pageId) };
  }
}
