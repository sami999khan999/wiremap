import { ConflictError, NotFoundError, type UserId } from "../import.js";
import type { MemberRepository } from "../member/index.js";
import { MemberRules } from "../member/index.js";
import type {
  ActivityLogger,
  CapabilityInvalidator,
  DomainEventPublisher,
  UnitOfWork,
} from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { RoleRepository } from "../rbac/index.js";

export interface TransferOwnershipInput {
  readonly userId: UserId;
}

// The system role the outgoing owner steps down to: everything an owner does day to day,
// short of handing the tenant on or deleting it.
const STEP_DOWN_KEY = "admin";

// Hands the tenant to another active member. One transaction, so there is never a moment
// with two owners or with none: the new owner is promoted and the caller stepped down.
export class TransferOwnershipUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly roles: RoleRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: TransferOwnershipInput): Promise<void> {
    this.authorizer.assert(actor, "organization.ownership.transfer");

    if (input.userId === actor.userId) throw new ConflictError("organization", "self");

    const target = await this.members.findByUser(actor.organizationId, input.userId);
    if (!target) throw new NotFoundError("member", input.userId);
    if (target.deactivated || target.suspended) throw new ConflictError("member", "inactive");

    const caller = await this.members.findByUser(actor.organizationId, actor.userId);
    if (!caller || !MemberRules.isOwner(caller))
      throw new ConflictError("organization", "notOwner");

    const owner = await this.roles.findByKey(actor.organizationId, MemberRules.OWNER_KEY);
    const admin = await this.roles.findByKey(actor.organizationId, STEP_DOWN_KEY);
    if (!owner || !admin) throw new NotFoundError("role", MemberRules.OWNER_KEY);

    await this.unitOfWork.run(async () => {
      await this.members.changeRole(actor.organizationId, target.userId, owner.id);
      await this.members.changeRole(actor.organizationId, actor.userId, admin.id);
      await this.activity.record(actor, "organization.ownership.transferred", {
        from: actor.userId,
        to: target.userId,
      });
      await this.events.publish(actor, {
        name: "member.role.changed",
        payload: { userId: target.userId, roleId: owner.id, previousRoleId: target.roleId },
      });
    });

    await this.capabilities.invalidate(actor.organizationId, target.userId);
    await this.capabilities.invalidate(actor.organizationId, actor.userId);
  }
}
