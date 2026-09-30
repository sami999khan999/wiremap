import {
  type Clock,
  ConflictError,
  type InvitationId,
  NotFoundError,
  type RoleId,
  Token,
  Uuid,
} from "../import.js";
import type { ActivityLogger, DomainEventPublisher, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityRepository } from "../rbac/capability.repository.js";
import type { RoleRepository } from "../rbac/role.repository.js";
import { RoleRules } from "../rbac/role.rules.js";
import type { InvitationMailer } from "./invitation.mailer.js";
import type { InvitationRecord, InvitationRepository } from "./invitation.repository.js";
import type { MemberRepository } from "./member.repository.js";
import { MemberRules } from "./member.rules.js";

export interface InviteMemberInput {
  readonly email: string;
  readonly roleId: RoleId;
}

// LOAD → AUTHORIZE → WORK → PERSIST, then the mail — after the commit, because an
// invitation message about a row that rolled back is a link to nothing.
export class InviteMemberUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly roles: RoleRepository,
    private readonly members: MemberRepository,
    private readonly invitations: InvitationRepository,
    private readonly mailer: InvitationMailer,
    private readonly activity: ActivityLogger,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    // The org's plan, so a key it no longer has cannot block inviting to a role that lists it.
    private readonly entitlements: CapabilityRepository,
  ) {}

  public async execute(actor: Principal, input: InviteMemberInput): Promise<InvitationRecord> {
    this.authorizer.assert(actor, "member.invite");

    // A role id from another organization parses just as well, so looking it up under
    // the actor's tenant is what stops it.
    const role = await this.roles.findById(actor.organizationId, input.roleId);
    if (!role) throw new NotFoundError("role", input.roleId);
    RoleRules.assertMembershipScope(role);
    RoleRules.assertAssignableBy(
      actor,
      role,
      await this.entitlements.entitlementFor(actor.organizationId),
    );

    // Lowercased once, here, so the unique index on `(organization_id, email)` sees one
    // address as one row.
    const email = input.email.trim().toLowerCase();

    if (await this.members.existsByEmail(actor.organizationId, email)) {
      throw new ConflictError("member", "already_member");
    }

    const now = this.clock.now();
    const id = Uuid.v7() as InvitationId;
    // The token goes to the mailbox and the digest goes to the table, so a dump of
    // `invitations` holds nothing anyone can accept with.
    const token = Token.random();
    const tokenHash = await Token.hash(token);

    await this.unitOfWork.run(async () => {
      await this.invitations.save({
        id,
        organizationId: actor.organizationId,
        email,
        roleId: input.roleId,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt: MemberRules.invitationExpiry(now),
        createdAt: now,
      });
      await this.activity.record(actor, "member.invited", { email, roleId: input.roleId });
      // The token never rides the event, which is what `token_hash` exists to prevent.
      // The mail below is a direct `MailPublisher` call for the same reason.
      await this.events.publish(actor, {
        name: "member.invited",
        payload: { invitationId: id, email, roleId: input.roleId, invitedBy: actor.userId },
      });
    });

    // Read back rather than assembled: the names the mail carries are the row's joins.
    const saved = await this.invitations.findById(actor.organizationId, id);
    if (!saved) throw new NotFoundError("invitation", id);

    // Still after the commit and still swallowed: the token cannot ride a durable row, so
    // the enqueue is the one step that cannot be made atomic with the invitation.
    try {
      await this.mailer.send({
        to: saved.email,
        organizationId: actor.organizationId,
        organizationName: saved.organizationName,
        inviterName: saved.inviterName,
        token,
      });
    } catch {
      // The operator action for a crash in that window is `ResendInvitationUseCase`, which
      // reissues the token on this row rather than replacing it.
    }

    return saved;
  }
}
