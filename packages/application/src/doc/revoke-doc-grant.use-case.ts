import { NotFoundError, type RevokeDocGrantInput } from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { DocAccess } from "./doc-access.js";
import type { DocGrantRepository } from "./doc-grant.repository.js";

// Withdraws one grant. Readers holding a cached answer lose access within a minute; the
// cache is cleared after the commit so that is normally at once.
export class RevokeDocGrantUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly grants: DocGrantRepository,
    private readonly access: DocAccess,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: RevokeDocGrantInput): Promise<void> {
    this.authorizer.assert(actor, "platform.doc.grant");

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      const spaceId = await this.grants.delete(input.grantId);
      if (!spaceId) throw new NotFoundError("doc.grant", input.grantId);
      await this.activity.record(auditor, "doc.grant.revoked", {
        grantId: input.grantId,
        spaceId,
      });
    });

    await this.access.forget();
  }
}
