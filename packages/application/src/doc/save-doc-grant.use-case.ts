import {
  type Clock,
  type DocGrantDto,
  NotFoundError,
  type SaveDocGrantInput,
  Uuid,
  ValidationError,
} from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import { DocRules } from "./doc.rules.js";
import type { DocAccess } from "./doc-access.js";
import type { DocGrantRepository } from "./doc-grant.repository.js";
import type { DocSpaceRepository } from "./doc-space.repository.js";

// Opens a private platform space to an organization, a person, or everyone on a plan.
// Audited in the platform's own trail, whichever organization the admin is acting from.
export class SaveDocGrantUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly grants: DocGrantRepository,
    private readonly spaces: DocSpaceRepository,
    private readonly access: DocAccess,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: SaveDocGrantInput): Promise<DocGrantDto> {
    this.authorizer.assert(actor, "platform.doc.grant");
    if (input.expiresAt && input.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new ValidationError([{ field: "expiresAt", rule: "past" }]);
    }

    const platformOrganizationId = await this.platform.organizationId();
    const space = await this.spaces.findById(platformOrganizationId, input.spaceId);
    if (!space) throw new NotFoundError("doc.space", input.spaceId);
    DocRules.assertGrantable(space);

    const grantee = await this.grants.findGrantee(input.kind, input.target);
    if (!grantee) throw new NotFoundError(input.kind, input.target);

    const auditor = new Principal(
      platformOrganizationId,
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    const saved = await this.unitOfWork.run(async () => {
      const grant = await this.grants.save({
        id: Uuid.v7(),
        spaceId: input.spaceId,
        grantee,
        reason: input.reason,
        expiresAt: input.expiresAt,
        createdBy: actor.userId,
      });
      await this.activity.record(auditor, "doc.grant.saved", {
        spaceId: input.spaceId,
        kind: grantee.kind,
        grantee: grantee.key,
        reason: input.reason,
        expiresAt: input.expiresAt?.toISOString() ?? "",
      });
      return grant;
    });

    await this.access.forget();
    return saved;
  }
}
