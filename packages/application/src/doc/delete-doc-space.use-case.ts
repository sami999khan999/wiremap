import type { DocSpaceRefInput } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import type { DocAccess } from "./doc-access.js";
import type { DocGrantRepository } from "./doc-grant.repository.js";
import { DocImageKey } from "./doc-image-key.js";
import type { DocImageSweep } from "./doc-image-sweep.js";
import type { DocPageRepository } from "./doc-page.repository.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// The space, every page in it, and every revision of those pages, in one transaction.
export class DeleteDocSpaceUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly pages: DocPageRepository,
    private readonly grants: DocGrantRepository,
    private readonly access: DocAccess,
    private readonly cache: DocCache,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly images: DocImageSweep,
  ) {}

  public async execute(actor: Principal, input: DocSpaceRefInput): Promise<void> {
    this.authorizer.assert(actor, "doc.space.manage");

    const space = await this.unitOfWork.run(async () => {
      const found = DocRules.assertVisible(
        await this.spaces.findById(actor.organizationId, input.spaceId),
        actor.userId,
        "doc.space",
        input.spaceId,
      );

      await this.pages.deleteBySpace(actor.organizationId, input.spaceId);
      await this.spaces.delete(actor.organizationId, input.spaceId);
      await this.activity.record(actor, "doc.space.deleted", {
        spaceId: input.spaceId,
        slug: found.slug,
      });
      return found;
    });

    // After, on the catalog, and never inside the routed transaction: the two are different
    // databases once the deployment splits. Whatever the audience now, since it may have changed.
    await this.grants.deleteBySpace(input.spaceId);
    await this.access.forget();
    await this.cache.forget(actor.organizationId, space.slug);
    // Last: an image that outlives a failure here is unreachable, since its space is gone.
    await this.images.sweep(DocImageKey.spacePrefix(actor.organizationId, input.spaceId));
  }
}
