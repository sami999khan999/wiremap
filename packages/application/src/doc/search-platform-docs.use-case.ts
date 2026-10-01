import type { DocSearchHitsDto, SearchDocsInput } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import type { DocAccess } from "./doc-access.js";
import type { DocFeaturePolicy } from "./doc-feature.policy.js";
import type { DocSearch } from "./doc-search.js";

// The same search over the platform's docs, narrowed to the spaces this viewer may read.
// Null is an anonymous reader, who searches the public ones.
export class SearchPlatformDocsUseCase {
  public constructor(
    private readonly platform: PlatformReader,
    private readonly spaces: DocCache,
    private readonly access: DocAccess,
    private readonly search: DocSearch,
    private readonly features: DocFeaturePolicy,
  ) {}

  public async execute(
    viewer: Principal | null,
    input: SearchDocsInput,
  ): Promise<DocSearchHitsDto> {
    const platformOrganizationId = await this.platform.organizationId();
    const spaces = await this.spaces.list(platformOrganizationId);

    // Sequential for the reason `ListPlatformDocSpacesUseCase` gives: one grant lookup, then
    // every later space answered from the cache it filled.
    const scope = this.features.scope(viewer);
    const readable = [];
    for (const space of spaces) {
      if (!(await this.access.canRead(viewer, space, platformOrganizationId))) continue;
      if (await this.features.allows(scope, space.access)) readable.push(space);
    }
    return {
      items: await this.search.run(
        platformOrganizationId,
        input.query,
        readable,
        input.limit,
        scope,
      ),
    };
  }
}
