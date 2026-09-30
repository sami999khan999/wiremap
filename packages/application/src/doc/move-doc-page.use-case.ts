import { type MoveDocPageInput, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";
import type { DocTree } from "./doc-tree.js";

// A new parent, a new place among its siblings, or both. The whole tree is checked as it
// would be after the move, since a move changes the path of everything under the page.
export class MoveDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
    private readonly tree: DocTree,
    private readonly cache: DocCache,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: MoveDocPageInput): Promise<void> {
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
      DocRules.assertTree(
        nodes.map((node) => (node.id === page.id ? { ...node, parentId: input.parentId } : node)),
      );

      const siblings = nodes
        .filter((node) => node.parentId === input.parentId && node.id !== page.id)
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
        .map((node) => node.id);
      siblings.splice(Math.min(input.position, siblings.length), 0, page.id);

      await this.pages.saveOrder(organizationId, input.parentId, siblings);
      await this.tree.rebuild(organizationId, page.spaceId);
      await this.activity.record(actor, "doc.page.moved", {
        spaceId: page.spaceId,
        pageId: page.id,
        parentId: input.parentId,
        position: input.position,
      });
      return (await this.spaces.findById(organizationId, page.spaceId))?.slug ?? null;
    });

    if (slug !== null) await this.cache.forget(organizationId, slug);
  }
}
