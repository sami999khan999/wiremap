import type { DocSearchHitsDto, SearchDocsInput } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocAccess } from "./doc-access.js";
import type { DocSearch } from "./doc-search.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// The same search over the platform's docs, narrowed to the spaces this viewer may read.
// Null is an anonymous reader, who searches the public ones.
export class SearchPlatformDocsUseCase {
  public constructor(
    private readonly platform: PlatformReader,
    private readonly spaces: DocSpaceRepository,
    private readonly access: DocAccess,
    private readonly search: DocSearch,
  ) {}

  public async execute(
    viewer: Principal | null,
    input: SearchDocsInput,
  ): Promise<DocSearchHitsDto> {
    const platformOrganizationId = await this.platform.organizationId();
    const spaces = await this.spaces.list(platformOrganizationId);

    // Sequential for the reason `ListPlatformDocSpacesUseCase` gives: one grant lookup, then
    // every later space answered from the cache it filled.
    const readable = [];
    for (const space of spaces) {
      if (await this.access.canRead(viewer, space, platformOrganizationId)) readable.push(space);
    }
    return {
      items: await this.search.run(platformOrganizationId, input.query, readable, input.limit),
    };
  }
}
