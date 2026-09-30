import {
  ConflictError,
  type DocPageDraftDto,
  NotFoundError,
  type SaveDocPageInput,
  ValidationError,
} from "../import.js";
import type { UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";
import type { DocTree } from "./doc-tree.js";

// The editor's save. Not audited: it changes nothing a reader sees. The slug and icon
// are structure rather than content, so they reach the reader's tree at once.
export class SaveDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
    private readonly tree: DocTree,
    private readonly cache: DocCache,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: SaveDocPageInput): Promise<DocPageDraftDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const organizationId = actor.organizationId;

    const { slug, page } = await this.unitOfWork.run(async () => {
      const current = await this.pages.findDraft(organizationId, input.pageId);
      if (!current) throw new NotFoundError("doc.page", input.pageId);
      DocRules.assertVisible(
        await this.spaces.findById(organizationId, current.spaceId),
        actor.userId,
        "doc.page",
        input.pageId,
      );
      if (current.kind === "link" && input.url === null) {
        throw new ValidationError([{ field: "url", rule: "required" }]);
      }

      const structural =
        current.kind !== "page" || current.slug !== input.slug || current.icon !== input.icon;
      if (current.slug !== input.slug) {
        const nodes = await this.pages.listBySpace(organizationId, current.spaceId);
        DocRules.assertTree(
          nodes.map((node) => (node.id === current.id ? { ...node, slug: input.slug } : node)),
        );
      }

      const saved = await this.pages.saveDraft(
        organizationId,
        input.pageId,
        input.draftVersion,
        {
          slug: input.slug,
          title: input.title,
          description: input.description,
          icon: input.icon,
          markdown: current.kind === "page" ? input.markdown : "",
          url: current.kind === "link" ? input.url : null,
        },
        actor.userId,
      );
      if (!saved) throw new ConflictError("doc.page", "stale");

      let spaceSlug: string | null = null;
      if (structural) {
        await this.tree.rebuild(organizationId, current.spaceId);
        spaceSlug = (await this.spaces.findById(organizationId, current.spaceId))?.slug ?? null;
      }
      return { slug: spaceSlug, page: await this.pages.findDraft(organizationId, input.pageId) };
    });

    if (slug !== null) await this.cache.forget(organizationId, slug);
    if (!page) throw new NotFoundError("doc.page", input.pageId);
    return DocShape.draft(page);
  }
}
