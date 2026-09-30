import { type Clock, ConflictError, NotFoundError, type UserId } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { MemberRecord, MemberRepository } from "./member.repository.js";
import { MemberRules } from "./member.rules.js";

export interface SetMemberActiveInput {
  readonly userId: UserId;
}

// Both directions in one class, because they are one column and one rule. The two
// procedures above it are separate so a product can gate them apart later.
export class SetMemberActiveUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actor: Principal,
    input: SetMemberActiveInput,
    active: boolean,
  ): Promise<MemberRecord> {
    this.authorizer.assert(actor, "member.deactivate");

    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);

    if (member.deactivated === !active) return member;

    // Locking yourself out is recoverable by a colleague; locking out the last owner
    // is not recoverable from inside the product at all.
    if (!active && member.userId === actor.userId) throw new ConflictError("member", "self");

    const at = active ? null : this.clock.now();
    const risky = !active && MemberRules.isOwner(member);

    await this.unitOfWork.run(async () => {
      // Inside the transaction and before the write. Read outside it, two concurrent
      // deactivations each saw two owners and the tenant committed its way down to none.
      if (risky) await this.assertNotLastOwner(actor);

      await this.members.setDeactivatedAt(actor.organizationId, member.userId, at);
      await this.activity.record(actor, active ? "member.reactivated" : "member.deactivated", {
        userId: member.userId,
      });
    });

    // After the commit, as a role change does. Deactivation refuses the principal on the
    // next request anyway; this is the platform axis, cached per user for a minute.
    await this.capabilities.invalidate(actor.organizationId, member.userId);

    return { ...member, deactivated: !active };
  }

  // `lockActiveOwners`, not `countActiveOwners`: the lock is what makes the second
  // deactivation wait and then read the number its own commit would leave behind.
  private async assertNotLastOwner(actor: Principal): Promise<void> {
    const owners = await this.members.lockActiveOwners(actor.organizationId);
    if (owners <= 1) throw new ConflictError("member", "lastOwner");
  }
}
