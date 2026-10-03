import { type Clock, type InvitationLinkId, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { InvitationLinkRepository } from "./invitation-link.repository.js";

export interface RevokeInvitationLinkInput {
  readonly linkId: InvitationLinkId;
}

// A link that leaked is closed at once; whoever joined through it stays a member.
export class RevokeInvitationLinkUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly links: InvitationLinkRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: RevokeInvitationLinkInput): Promise<void> {
    this.authorizer.assert(actor, "member.invite");

    const link = await this.links.findById(actor.organizationId, input.linkId);
    if (!link) throw new NotFoundError("invitationLink", input.linkId);

    await this.unitOfWork.run(async () => {
      await this.links.revoke(actor.organizationId, link.id, this.clock.now());
      await this.activity.record(actor, "member.link.revoked", { linkId: link.id });
    });
  }
}
