import { type DocRevisionDto, type DocRevisionRefInput, NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocPageRepository } from "./doc-page.repository.js";

export class GetDocRevisionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly pages: DocPageRepository,
  ) {}

  public async execute(actor: Principal, input: DocRevisionRefInput): Promise<DocRevisionDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const revision = await this.pages.findRevision(
      actor.organizationId,
      input.pageId,
      input.revisionNo,
    );
    if (!revision) throw new NotFoundError("doc.revision", `${input.pageId}:${input.revisionNo}`);
    return revision;
  }
}
