import {
  type Clock,
  type InvitationLinkId,
  NotFoundError,
  type RoleId,
  Token,
  Uuid,
} from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { type CapabilityRepository, type RoleRepository, RoleRules } from "../rbac/index.js";
import type {
  InvitationLinkRecord,
  InvitationLinkRepository,
} from "./invitation-link.repository.js";

export interface CreateInvitationLinkInput {
  readonly roleId: RoleId;
  readonly expiresInDays: number;
  readonly maxUses: number | null;
}

export interface CreatedInvitationLink extends InvitationLinkRecord {
  readonly token: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// An invitation without an address. The role it hands out is capped by the creator's own
// keys, exactly as an emailed invitation is, so a link cannot widen anyone's reach.
export class CreateInvitationLinkUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly links: InvitationLinkRepository,
    private readonly roles: RoleRepository,
    private readonly entitlements: CapabilityRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actor: Principal,
    input: CreateInvitationLinkInput,
  ): Promise<CreatedInvitationLink> {
    this.authorizer.assert(actor, "member.invite");

    const role = await this.roles.findById(actor.organizationId, input.roleId);
    if (!role) throw new NotFoundError("role", input.roleId);
    RoleRules.assertAssignableBy(
      actor,
      role,
      await this.entitlements.entitlementFor(actor.organizationId),
    );

    const token = Token.random();
    const id = Uuid.v7() as InvitationLinkId;
    const expiresAt = new Date(this.clock.now().getTime() + input.expiresInDays * DAY_MS);

    await this.unitOfWork.run(async () => {
      await this.links.save(actor.organizationId, {
        id,
        roleId: role.id,
        createdBy: actor.userId,
        tokenHash: await Token.hash(token),
        expiresAt,
        maxUses: input.maxUses,
      });
      await this.activity.record(actor, "member.link.created", {
        linkId: id,
        roleId: role.id,
        expiresAt: expiresAt.toISOString(),
        maxUses: input.maxUses,
      });
    });

    const saved = await this.links.findById(actor.organizationId, id);
    if (!saved) throw new NotFoundError("invitationLink", id);
    return { ...saved, token };
  }
}
