import {
  type DocSpaceDto,
  NotFoundError,
  type UpdateDocSpaceInput,
  ValidationError,
} from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

export class UpdateDocSpaceUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly platform: PlatformReader,
    private readonly cache: DocCache,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateDocSpaceInput): Promise<DocSpaceDto> {
    this.authorizer.assert(actor, "doc.space.manage");
    DocRules.assertSpaceSlug(input.slug);
    const isPlatform = actor.organizationId === (await this.platform.organizationId());
    DocRules.assertAudience(input.audience, isPlatform);

    const { before, after } = await this.unitOfWork.run(async () => {
      const current = DocRules.assertVisible(
        await this.spaces.findById(actor.organizationId, input.spaceId),
        actor.userId,
        "doc.space",
        input.spaceId,
      );
      DocRules.assertAudienceChange(current, input.audience, actor.userId);

      const saved = await this.spaces.save(
        actor.organizationId,
        input.spaceId,
        input,
        input.position,
      );
      if (!saved) throw new ValidationError([{ field: "slug", rule: "taken" }]);

      await this.activity.record(actor, "doc.space.updated", {
        spaceId: input.spaceId,
        slug: input.slug,
        audience: input.audience,
      });
      return {
        before: current,
        after: await this.spaces.findById(actor.organizationId, input.spaceId),
      };
    });

    // Both slugs: the old key would otherwise keep answering for a space that has moved.
    await this.cache.forget(actor.organizationId, before.slug, input.slug);
    if (!after) throw new NotFoundError("doc.space", input.spaceId);
    return DocShape.space(after);
  }
}
