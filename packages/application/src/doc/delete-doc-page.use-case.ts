import { type DocPageRefInput, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";
import type { DocTree } from "./doc-tree.js";

// The page and everything under it. Left behind, the children would hang from a parent
// that no longer exists, and no path could reach them.
export class DeleteDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
    private readonly tree: DocTree,
    private readonly cache: DocCache,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: DocPageRefInput): Promise<void> {
    this.authorizer.assert(actor, "doc.page.write");
    const organizationId = actor.organizationId;

    const slug = await this.unitOfWork.run(async () => {
      const page = await this.pages.findDraft(organizationId, input.pageId);
      if (!page) throw new NotFoundError("doc.page", input.pageId);
      DocRules.assertVisible(
        await this.spaces.findById(organizationId, page.spaceId),
        actor.userId,
        "doc.page",
        input.pageId,
      );

      const nodes = await this.pages.listBySpace(organizationId, page.spaceId);
      const ids = DocRules.subtree(nodes, page.id);

      await this.pages.delete(organizationId, ids);
      await this.tree.rebuild(organizationId, page.spaceId);
      await this.activity.record(actor, "doc.page.deleted", {
        spaceId: page.spaceId,
        pageId: page.id,
        count: ids.length,
      });
      return (await this.spaces.findById(organizationId, page.spaceId))?.slug ?? null;
    });

    if (slug !== null) await this.cache.forget(organizationId, slug);
  }
}
