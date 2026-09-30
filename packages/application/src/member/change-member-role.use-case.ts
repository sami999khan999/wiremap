import { ConflictError, NotFoundError, type RoleId, type UserId } from "../import.js";
import type {
  ActivityLogger,
  CapabilityInvalidator,
  DomainEventPublisher,
  UnitOfWork,
} from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { type CapabilityRepository, type RoleRepository, RoleRules } from "../rbac/index.js";
import type { MemberRecord, MemberRepository } from "./member.repository.js";
import { MemberRules } from "./member.rules.js";

export interface ChangeMemberRoleInput {
  readonly userId: UserId;
  readonly roleId: RoleId;
}

// Moving someone between roles. The rule that makes it interesting is the one it
// refuses: a tenant with no active owner cannot be recovered from inside the product.
export class ChangeMemberRoleUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly roles: RoleRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
    // The org's plan, so a key it no longer has cannot block handing out a role that lists it.
    private readonly entitlements: CapabilityRepository,
  ) {}

  public async execute(actor: Principal, input: ChangeMemberRoleInput): Promise<MemberRecord> {
    this.authorizer.assert(actor, "member.role.change");

    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);

    // Under the actor's tenant, so a role id from another organization is not found
    // rather than assigned across the boundary.
    const role = await this.roles.findById(actor.organizationId, input.roleId);
    if (!role) throw new NotFoundError("role", input.roleId);
    RoleRules.assertMembershipScope(role);
    RoleRules.assertAssignableBy(
      actor,
      role,
      await this.entitlements.entitlementFor(actor.organizationId),
    );

    if (member.roleId === role.id) return member;

    const demoting = MemberRules.isOwner(member) && !MemberRules.isOwnerKey(role.key);

    await this.unitOfWork.run(async () => {
      // Inside the transaction and before the write. Read outside it, two concurrent
      // demotions each saw two owners and the tenant committed its way down to none.
      if (demoting) await this.assertNotLastOwner(actor);

      await this.members.changeRole(actor.organizationId, member.userId, role.id);
      await this.activity.record(actor, "member.role.changed", {
        userId: member.userId,
        fromRoleId: member.roleId,
        toRoleId: role.id,
      });
      // Beside the audit row and in the same transaction. Audit is the human fact and
      // the outbox is the integration fact; they commit together or not at all.
      await this.events.publish(actor, {
        name: "member.role.changed",
        payload: { userId: member.userId, roleId: role.id, previousRoleId: member.roleId },
      });
    });

    // The new role decides what this person may do, and the old set is cached for a
    // minute. After the commit, so a concurrent read cannot re-cache what was replaced.
    await this.capabilities.invalidate(actor.organizationId, member.userId);

    return { ...member, roleId: role.id, roleKey: role.key, roleName: role.name };
  }

  // `lockActiveOwners`, not `countActiveOwners`: the lock is what makes the second
  // demotion wait and then read the number its own commit would leave behind.
  private async assertNotLastOwner(actor: Principal): Promise<void> {
    const owners = await this.members.lockActiveOwners(actor.organizationId);
    if (owners <= 1) throw new ConflictError("member", "lastOwner");
  }
}
