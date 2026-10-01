import {
  type CreateDocSpaceInput,
  type DocSpaceDto,
  type DocSpaceId,
  NotFoundError,
  Uuid,
  ValidationError,
} from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { DocCache } from "./doc.cache.js";
import { DocRules } from "./doc.rules.js";
import { DocShape } from "./doc-shape.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

export class CreateDocSpaceUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly spaces: DocSpaceRepository,
    private readonly platform: PlatformReader,
    private readonly cache: DocCache,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: CreateDocSpaceInput): Promise<DocSpaceDto> {
    this.authorizer.assert(actor, "doc.space.manage");
    DocRules.assertSpaceSlug(input.slug);
    const isPlatform = actor.organizationId === (await this.platform.organizationId());
    DocRules.assertAudience(input.audience, isPlatform);

    const id = Uuid.v7() as DocSpaceId;
    const space = await this.unitOfWork.run(async () => {
      const created = await this.spaces.create(actor.organizationId, id, input, actor.userId);
      if (!created) throw new ValidationError([{ field: "slug", rule: "taken" }]);

      await this.activity.record(actor, "doc.space.created", { spaceId: id, slug: input.slug });
      return this.spaces.findById(actor.organizationId, id);
    });

    if (!space) throw new NotFoundError("doc.space", id);
    await this.cache.forget(actor.organizationId, input.slug);
    return DocShape.space(space);
  }
}
