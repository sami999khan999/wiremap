import type { DocSpaceListDto } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import type { DocAccess } from "./doc-access.js";
import type { DocFeaturePolicy } from "./doc-feature.policy.js";
import { DocShape } from "./doc-shape.js";

// The platform spaces this viewer may open, for `/docs` and its switcher. Null is an
// anonymous reader, who sees the public ones.
export class ListPlatformDocSpacesUseCase {
  public constructor(
    private readonly platform: PlatformReader,
    private readonly spaces: DocCache,
    private readonly access: DocAccess,
    private readonly features: DocFeaturePolicy,
  ) {}

  public async execute(viewer: Principal | null): Promise<DocSpaceListDto> {
    const platformOrganizationId = await this.platform.organizationId();
    const spaces = await this.spaces.list(platformOrganizationId);

    // Sequential rather than `Promise.all`: `canRead` memoises the viewer's grants in the
    // cache, and a dozen parallel misses would be a dozen identical catalog reads.
    const scope = this.features.scope(viewer);
    const readable = [];
    for (const space of spaces) {
      if (!(await this.access.canRead(viewer, space, platformOrganizationId))) continue;
      if (await this.features.allows(scope, space.access)) readable.push(space);
    }
    return { items: readable.map((space) => DocShape.space(space)) };
  }
}
