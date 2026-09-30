import type { DocSpaceListDto } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocAccess } from "./doc-access.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// The platform spaces this viewer may open, for `/docs` and its switcher. Null is an
// anonymous reader, who sees the public ones.
export class ListPlatformDocSpacesUseCase {
  public constructor(
    private readonly platform: PlatformReader,
    private readonly spaces: DocSpaceRepository,
    private readonly access: DocAccess,
  ) {}

  public async execute(viewer: Principal | null): Promise<DocSpaceListDto> {
    const platformOrganizationId = await this.platform.organizationId();
    const spaces = await this.spaces.list(platformOrganizationId);

    // Sequential rather than `Promise.all`: `canRead` memoises the viewer's grants in the
    // cache, and a dozen parallel misses would be a dozen identical catalog reads.
    const readable = [];
    for (const space of spaces) {
      if (await this.access.canRead(viewer, space, platformOrganizationId)) readable.push(space);
    }
    return { items: readable.map((space) => DocShape.space(space)) };
  }
}
