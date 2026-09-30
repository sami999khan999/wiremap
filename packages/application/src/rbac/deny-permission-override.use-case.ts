import { NotFoundError, PermissionRegistry, type UserId } from "../import.js";
import type { MemberRepository } from "../member/member.repository.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityRepository } from "./capability.repository.js";
import type { PermissionOverrideRepository } from "./permission-override.repository.js";
import { PermissionOverrideRules } from "./permission-override.rules.js";
import type { RoleRepository } from "./role.repository.js";

export interface DenyPermissionOverrideInput {
  readonly userId: UserId;
  readonly permission: string;
  // Optional for a deny: narrowing someone needs no justification to stay safe.
  readonly reason: string | null;
}

// One person, one key, permanently. What depends on the key goes too (`RV.13`): a deny of
// the role list leaves no invite form with an empty picker behind it.
export class DenyPermissionOverrideUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly roles: RoleRepository,
    private readonly capabilities: CapabilityRepository,
    private readonly overrides: PermissionOverrideRepository,
    private readonly invalidator: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(
    actor: Principal,
    input: DenyPermissionOverrideInput,
  ): Promise<readonly string[]> {
    this.authorizer.assert(actor, "rbac.override.manage");

    const key = PermissionOverrideRules.assertOverridable(input.permission);
    PermissionOverrideRules.assertHeld(actor, key);
    const reason = input.reason?.trim() || null;

    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);
    const role = await this.roles.findById(actor.organizationId, member.roleId);
    if (!role) throw new NotFoundError("role", member.roleId);
    PermissionOverrideRules.assertTarget(
      actor,
      member,
      role,
      await this.capabilities.entitlementFor(actor.organizationId),
    );

    const keys = PermissionRegistry.instance.dependentClosure([key]);

    await this.unitOfWork.run(async () => {
      await this.overrides.save(
        actor.organizationId,
        member.userId,
        keys.map((permission) => ({
          permission,
          effect: "deny",
          reason,
          expiresAt: null,
          authority: "org",
        })),
        actor.userId,
      );
      await this.activity.record(actor, "override.denied", {
        userId: member.userId,
        permissions: keys.join(","),
        reason: reason ?? "",
        authority: "org",
      });
    });

    await this.invalidator.invalidate(actor.organizationId, member.userId);
    return keys;
  }
}
