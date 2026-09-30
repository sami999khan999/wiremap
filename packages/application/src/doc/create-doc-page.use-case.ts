import {
  type CreateDocPageInput,
  type DocPageDraftDto,
  type DocPageId,
  NotFoundError,
  Uuid,
  ValidationError,
} from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageNodeRecord, DocPageRepository } from "./doc-page.repository.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";
import type { DocTree } from "./doc-tree.js";

// A page starts as an empty draft and reaches readers only when published. A section or a
// link has nothing to publish, so it is in the reader's tree from the moment it exists.
export class CreateDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
    private readonly tree: DocTree,
    private readonly cache: DocCache,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: CreateDocPageInput): Promise<DocPageDraftDto> {
    this.authorizer.assert(actor, "doc.page.write");
    if (input.kind === "link" && input.url === null) {
      throw new ValidationError([{ field: "url", rule: "required" }]);
    }

    const organizationId = actor.organizationId;
    const id = Uuid.v7() as DocPageId;

    const { space, page } = await this.unitOfWork.run(async () => {
      const found = DocRules.assertVisible(
        await this.spaces.findById(organizationId, input.spaceId),
        actor.userId,
        "doc.space",
        input.spaceId,
      );

      const nodes = await this.pages.listBySpace(organizationId, input.spaceId);
      const position = nodes.filter((node) => node.parentId === input.parentId).length;
      const now = new Date();
      const candidate: DocPageNodeRecord = {
        id,
        spaceId: input.spaceId,
        parentId: input.parentId,
        kind: input.kind,
        slug: input.slug,
        title: input.title,
        icon: input.icon,
        url: input.kind === "link" ? input.url : null,
        position,
        draftVersion: 1,
        publishedDraftVersion: null,
        publishedTitle: null,
        revisionNo: 0,
        publishedAt: null,
        updatedAt: now,
      };
      DocRules.assertTree([...nodes, candidate]);

      await this.pages.create(organizationId, { ...candidate, createdBy: actor.userId });
      if (input.kind !== "page") await this.tree.rebuild(organizationId, input.spaceId);
      await this.activity.record(actor, "doc.page.created", {
        spaceId: input.spaceId,
        pageId: id,
        kind: input.kind,
      });
      return { space: found, page: await this.pages.findDraft(organizationId, id) };
    });

    if (input.kind !== "page") await this.cache.forget(organizationId, space.slug);
    if (!page) throw new NotFoundError("doc.page", id);
    return DocShape.draft(page);
  }
}
