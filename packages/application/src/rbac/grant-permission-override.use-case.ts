import { type Clock, NotFoundError, PermissionRegistry, type UserId } from "../import.js";
import type { MemberRepository } from "../member/member.repository.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityRepository } from "./capability.repository.js";
import { CapabilityResolution } from "./capability-resolution.js";
import type { PermissionOverrideRepository } from "./permission-override.repository.js";
import { PermissionOverrideRules } from "./permission-override.rules.js";
import type { RoleRepository } from "./role.repository.js";

export interface GrantPermissionOverrideInput {
  readonly userId: UserId;
  readonly permission: string;
  readonly reason: string;
  // Null is the default, thirty days. Never more than ninety.
  readonly expiresAt: Date | null;
}

// One person, one key, for a stated reason until a date. What the key needs and the person
// lacks comes with it, on the same terms, so the exception works on the day it is given.
export class GrantPermissionOverrideUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly roles: RoleRepository,
    private readonly capabilities: CapabilityRepository,
    private readonly overrides: PermissionOverrideRepository,
    private readonly invalidator: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actor: Principal,
    input: GrantPermissionOverrideInput,
  ): Promise<readonly string[]> {
    this.authorizer.assert(actor, "rbac.override.manage");

    const key = PermissionOverrideRules.assertOverridable(input.permission);
    const reason = PermissionOverrideRules.assertReason(input.reason);
    const expiresAt = PermissionOverrideRules.expiryFor(input.expiresAt, this.clock.now());

    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);
    const role = await this.roles.findById(actor.organizationId, member.roleId);
    if (!role) throw new NotFoundError("role", member.roleId);

    const explanation = await this.capabilities.explainFor(actor.organizationId, member.userId);
    PermissionOverrideRules.assertTarget(actor, member, role, explanation.entitlement);

    // The requirements the person lacks today; the ones they hold need no exception.
    const current = CapabilityResolution.fold(explanation);
    const keys = PermissionRegistry.instance
      .closure([key])
      .filter((entry) => entry === key || !current.can(entry));
    for (const entry of keys) PermissionOverrideRules.assertHeld(actor, entry);

    await this.unitOfWork.run(async () => {
      await this.overrides.save(
        actor.organizationId,
        member.userId,
        keys.map((permission) => ({
          permission,
          effect: "grant",
          reason,
          expiresAt,
          authority: "org",
        })),
        actor.userId,
      );
      await this.activity.record(actor, "override.granted", {
        userId: member.userId,
        permissions: keys.join(","),
        reason,
        expiresAt: expiresAt.toISOString(),
      });
    });

    await this.invalidator.invalidate(actor.organizationId, member.userId);
    return keys;
  }
}
