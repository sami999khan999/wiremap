import { type DocReadingDto, NotFoundError, type ReadDocPageInput } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocAccess } from "./doc-access.js";
import { DocShape } from "./doc-shape.js";

// The platform's public and granted spaces, read by anyone — signed in or not, from any
// organization. Placed at the platform organization's node by the caller.
// ──
// `viewer` is null for an anonymous reader: this one use-case takes no principal, because
// its whole question is what somebody holding none may see.
export class ReadPlatformDocUseCase {
  public constructor(
    private readonly platform: PlatformReader,
    private readonly cache: DocCache,
    private readonly access: DocAccess,
  ) {}

  public async execute(viewer: Principal | null, input: ReadDocPageInput): Promise<DocReadingDto> {
    const platformOrganizationId = await this.platform.organizationId();
    const space = await this.cache.space(platformOrganizationId, input.space);

    // One answer for "no such space" and "not yours to read", so a private slug cannot be
    // found by asking for it.
    if (!space || !(await this.access.canRead(viewer, space, platformOrganizationId))) {
      throw new NotFoundError("doc.space", input.space);
    }

    const { page } = await this.cache.readIn(space, input.path);
    // Trimmed: a large space's whole tree in every page read is what made one slow.
    const nav = DocRules.trimNav(space.nav, page?.id ?? null);
    return { space: { ...DocShape.space(space), nav }, page };
  }
}
