import { type InvitationId, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { InvitationRepository } from "./invitation.repository.js";

export interface RevokeInvitationInput {
  readonly invitationId: InvitationId;
}

// Deleting the row is the whole revocation: a claim then finds nothing. The audit row is
// what remembers it happened.
export class RevokeInvitationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly invitations: InvitationRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: RevokeInvitationInput): Promise<void> {
    this.authorizer.assert(actor, "member.invite");

    // Under the actor's tenant, so an id from another organization is not found rather
    // than deleted.
    const invitation = await this.invitations.findById(actor.organizationId, input.invitationId);
    if (!invitation) throw new NotFoundError("invitation", input.invitationId);

    await this.unitOfWork.run(async () => {
      await this.invitations.delete(actor.organizationId, invitation.id);
      await this.activity.record(actor, "member.invitation.revoked", {
        invitationId: invitation.id,
        email: invitation.email,
      });
    });
  }
}
