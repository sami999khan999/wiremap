import { type DocSpaceNavDto, type DocSpaceNavInput, NotFoundError } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import type { DocAccess } from "./doc-access.js";
import type { DocFeaturePolicy } from "./doc-feature.policy.js";

// The platform's version of `ReadDocNavUseCase`: the same access as a page read, with null
// for an anonymous reader, and the same not-found for a space they may not open.
export class ReadPlatformDocNavUseCase {
  public constructor(
    private readonly platform: PlatformReader,
    private readonly cache: DocCache,
    private readonly features: DocFeaturePolicy,
    private readonly access: DocAccess,
  ) {}

  public async execute(viewer: Principal | null, input: DocSpaceNavInput): Promise<DocSpaceNavDto> {
    const platformOrganizationId = await this.platform.organizationId();
    const space = await this.cache.space(platformOrganizationId, input.slug);
    const scope = this.features.scope(viewer);
    if (
      !space ||
      !(await this.access.canRead(viewer, space, platformOrganizationId)) ||
      !(await this.features.allows(scope, space.access))
    ) {
      throw new NotFoundError("doc.space", input.slug);
    }
    return { version: space.version, nav: await this.features.filterNav(scope, space.nav) };
  }
}
