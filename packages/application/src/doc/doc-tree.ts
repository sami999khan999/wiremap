import type { DocSpaceId, OrganizationId } from "../import.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// Rebuilds a space's published tree from its rows. Called inside the same unit of work as
// the change, so the tree and the pages it points at commit together or not at all.
export class DocTree {
  public constructor(
    private readonly pages: DocPageRepository,
    private readonly spaces: DocSpaceRepository,
  ) {}

  public async rebuild(organizationId: OrganizationId, spaceId: DocSpaceId): Promise<number> {
    const nodes = await this.pages.listBySpace(organizationId, spaceId);
    return this.spaces.saveNav(organizationId, spaceId, DocRules.buildNav(nodes));
  }
}
