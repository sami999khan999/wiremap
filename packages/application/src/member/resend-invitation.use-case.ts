import { type Clock, type InvitationId, NotFoundError, Token } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { InvitationMailer } from "./invitation.mailer.js";
import type { InvitationRecord, InvitationRepository } from "./invitation.repository.js";
import { MemberRules } from "./member.rules.js";

export interface ResendInvitationInput {
  readonly invitationId: InvitationId;
}

// A resend is a **reissue**. Only the digest is stored, so the original token cannot be
// read back — the row gets a new one and the old link stops working.
export class ResendInvitationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly invitations: InvitationRepository,
    private readonly mailer: InvitationMailer,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: ResendInvitationInput): Promise<InvitationRecord> {
    // The same key as inviting, because it is the same act: a new token to an address
    // somebody already decided to invite.
    this.authorizer.assert(actor, "member.invite");

    // Under the actor's tenant, so an id from another organization is not found rather
    // than resent.
    const invitation = await this.invitations.findById(actor.organizationId, input.invitationId);
    if (!invitation) throw new NotFoundError("invitation", input.invitationId);

    const now = this.clock.now();
    const token = Token.random();
    const tokenHash = await Token.hash(token);
    const expiresAt = MemberRules.invitationExpiry(now);

    await this.unitOfWork.run(async () => {
      // `createdAt` is the original. The row is the same invitation with a live token,
      // and a list ordered by when it was first sent should not reshuffle.
      await this.invitations.save({
        id: invitation.id,
        organizationId: actor.organizationId,
        email: invitation.email,
        roleId: invitation.roleId,
        tokenHash,
        invitedBy: invitation.invitedBy,
        expiresAt,
        createdAt: invitation.createdAt,
      });
      await this.activity.record(actor, "member.invitation.resent", {
        invitationId: invitation.id,
        email: invitation.email,
      });
    });

    // No domain event: `member.invited` fired when the invitation was created, and a
    // subscriber that heard it twice would act twice on one invitation.

    // **Not swallowed**, unlike `InviteMemberUseCase`: there the mail is a consequence
    // of the work, here it is the work itself.
    await this.mailer.send({
      to: invitation.email,
      organizationId: actor.organizationId,
      organizationName: invitation.organizationName,
      inviterName: invitation.inviterName,
      token,
    });

    return { ...invitation, expiresAt };
  }
}
