import { ConflictError, NotFoundError, type UserId } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { type CapabilityRepository, type RoleRepository, RoleRules } from "../rbac/index.js";
import type { MemberRepository } from "./member.repository.js";
import { MemberRules } from "./member.rules.js";

export interface RemoveMemberInput {
  readonly userId: UserId;
}

// The membership ends, where deactivation only pauses it. The same three guards as
// deactivation: not yourself, not someone who outranks you, not the last owner.
export class RemoveMemberUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly roles: RoleRepository,
    private readonly entitlements: CapabilityRepository,
  ) {}

  public async execute(actor: Principal, input: RemoveMemberInput): Promise<void> {
    this.authorizer.assert(actor, "member.remove");

    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);

    // Leaving is not this procedure: an owner who removed themselves could strand the tenant.
    if (member.userId === actor.userId) throw new ConflictError("member", "self");

    const role = await this.roles.findById(actor.organizationId, member.roleId);
    if (role) {
      const entitlement = await this.entitlements.entitlementFor(actor.organizationId);
      RoleRules.assertAssignableBy(actor, role, entitlement);
    }

    const guard = MemberRules.lastHolderGuard(member.roleKey, null);

    await this.unitOfWork.run(async () => {
      // Locked inside the transaction, for the reason `SetMemberActiveUseCase` gives.
      if (guard) {
        const holders = await this.members.lockActiveHolders(actor.organizationId, guard.keys);
        if (holders <= 1) throw new ConflictError("member", guard.reason);
      }

      await this.members.delete(actor.organizationId, member.userId);
      await this.activity.record(actor, "member.removed", {
        userId: member.userId,
        roleId: member.roleId,
      });
    });

    await this.capabilities.invalidate(actor.organizationId, member.userId);
  }
}
