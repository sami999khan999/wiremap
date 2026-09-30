import type { DocSearchHitsDto, SearchDocsInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocSearch } from "./doc-search.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// The Ctrl K palette's full-text half, over the actor's own organization's docs.
export class SearchDocsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly search: DocSearch,
  ) {}

  public async execute(actor: Principal, input: SearchDocsInput): Promise<DocSearchHitsDto> {
    this.authorizer.assert(actor, "doc.page.read");
    const spaces = await this.spaces.list(actor.organizationId);
    return {
      items: await this.search.run(actor.organizationId, input.query, spaces, input.limit),
    };
  }
}
