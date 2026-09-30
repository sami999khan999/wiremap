import {
  ConflictError,
  type DocPageDraftDto,
  NotFoundError,
  type RestoreDocRevisionInput,
} from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { DocRules } from "./doc.rules.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// Into the draft, never straight to readers: restoring is how an author gets the old text
// back to look at, and publishing it is a second decision.
export class RestoreDocRevisionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly pages: DocPageRepository,
    private readonly spaces: DocSpaceRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: RestoreDocRevisionInput): Promise<DocPageDraftDto> {
    this.authorizer.assert(actor, "doc.page.write");
    const organizationId = actor.organizationId;

    const page = await this.unitOfWork.run(async () => {
      const current = await this.pages.findDraft(organizationId, input.pageId);
      if (!current) throw new NotFoundError("doc.page", input.pageId);
      DocRules.assertVisible(
        await this.spaces.findById(organizationId, current.spaceId),
        actor.userId,
        "doc.page",
        input.pageId,
      );
      const revision = await this.pages.findRevision(
        organizationId,
        input.pageId,
        input.revisionNo,
      );
      if (!revision) {
        throw new NotFoundError("doc.revision", `${input.pageId}:${input.revisionNo}`);
      }

      // The slug, icon and link stay as they are: they are structure, and a revision
      // holds only what was published.
      const saved = await this.pages.saveDraft(
        organizationId,
        input.pageId,
        input.draftVersion,
        {
          slug: current.slug,
          title: revision.title,
          description: revision.description,
          icon: current.icon,
          markdown: revision.markdown,
          url: current.url,
        },
        actor.userId,
      );
      if (!saved) throw new ConflictError("doc.page", "stale");

      await this.activity.record(actor, "doc.page.restored", {
        spaceId: current.spaceId,
        pageId: input.pageId,
        revisionNo: input.revisionNo,
      });
      return this.pages.findDraft(organizationId, input.pageId);
    });

    if (!page) throw new NotFoundError("doc.page", input.pageId);
    return DocShape.draft(page);
  }
}
