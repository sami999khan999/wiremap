import {
  ConflictError,
  type DocPageDraftDto,
  NotFoundError,
  type PublishDocPageInput,
} from "../import.js";
import type { ActivityLogger, MarkdownRenderer, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import type { DocPageRepository, DocPublication } from "./doc-page.repository.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";
import type { DocTree } from "./doc-tree.js";

// Render once, here, and never at read. The snapshot, the revision, the search sections
// and the rebuilt tree commit together, so a reader sees all of the publish or none of it.
export class PublishDocPageUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
    private readonly renderer: MarkdownRenderer,
    private readonly tree: DocTree,
    private readonly cache: DocCache,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: PublishDocPageInput): Promise<DocPageDraftDto> {
    this.authorizer.assert(actor, "doc.page.publish");
    const organizationId = actor.organizationId;

    const draft = await this.pages.findDraft(organizationId, input.pageId);
    if (!draft) throw new NotFoundError("doc.page", input.pageId);
    if (draft.kind !== "page") throw new ConflictError("doc.page", "not_publishable");
    // Before the render rather than only under the lock: a stale editor is told so without
    // paying for a render whose result would be thrown away.
    if (draft.draftVersion !== input.draftVersion) throw new ConflictError("doc.page", "stale");

    // Outside the transaction: rendering holds no lock and needs none.
    const rendered = await this.renderer.render(draft.markdown);
    const publication: DocPublication = {
      title: draft.title,
      description: draft.description,
      markdown: draft.markdown,
      html: rendered.html,
      toc: rendered.toc,
      rendererVersion: this.renderer.version,
    };
    // The title is a section of its own, so a search for a page's name finds the page.
    const sections = [{ anchor: null, heading: draft.title, body: draft.description ?? "" }];

    const { slug, page } = await this.unitOfWork.run(async () => {
      const revisionNo = await this.pages.publish(
        organizationId,
        input.pageId,
        input.draftVersion,
        publication,
        actor.userId,
      );
      if (revisionNo === null) throw new ConflictError("doc.page", "stale");

      await this.pages.saveRevision(
        organizationId,
        draft.spaceId,
        input.pageId,
        revisionNo,
        publication,
        actor.userId,
      );
      await this.pages.saveSections(organizationId, draft.spaceId, input.pageId, [
        ...sections,
        ...rendered.sections,
      ]);
      await this.tree.rebuild(organizationId, draft.spaceId);
      await this.activity.record(actor, "doc.page.published", {
        spaceId: draft.spaceId,
        pageId: input.pageId,
        revisionNo,
      });

      const space = await this.spaces.findById(organizationId, draft.spaceId);
      return {
        slug: space?.slug ?? null,
        page: await this.pages.findDraft(organizationId, input.pageId),
      };
    });

    if (slug !== null) await this.cache.forget(organizationId, slug);
    if (!page) throw new NotFoundError("doc.page", input.pageId);
    return DocShape.draft(page);
  }
}
