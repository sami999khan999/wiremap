import { ConflictError, NotFoundError } from "../import.js";
import type { MemberRepository } from "../member/member.repository.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityRepository } from "./capability.repository.js";
import type { PermissionOverrideRepository } from "./permission-override.repository.js";
import { PermissionOverrideRules } from "./permission-override.rules.js";
import type { RoleRepository } from "./role.repository.js";

export interface ClearPermissionOverrideInput {
  readonly overrideId: string;
}

// Back to what the role says for one key. A platform deny is the tier's, and the org admin
// sees it but cannot clear it: that is the whole point of one.
export class ClearPermissionOverrideUseCase {
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

  public async execute(actor: Principal, input: ClearPermissionOverrideInput): Promise<void> {
    this.authorizer.assert(actor, "rbac.override.manage");

    const row = await this.overrides.findById(actor.organizationId, input.overrideId);
    if (!row) throw new NotFoundError("override", input.overrideId);
    if (row.authority === "platform") throw new ConflictError("override", "platform");

    // Clearing a deny widens access, so it passes the same checks as writing a grant.
    const key = PermissionOverrideRules.assertOverridable(row.permission);
    PermissionOverrideRules.assertHeld(actor, key);
    const member = await this.members.findByUser(actor.organizationId, row.userId);
    if (!member) throw new NotFoundError("member", row.userId);
    const role = await this.roles.findById(actor.organizationId, member.roleId);
    if (!role) throw new NotFoundError("role", member.roleId);
    PermissionOverrideRules.assertTarget(
      actor,
      member,
      role,
      await this.capabilities.entitlementFor(actor.organizationId),
    );

    await this.unitOfWork.run(async () => {
      await this.overrides.delete(actor.organizationId, row.id);
      await this.activity.record(actor, "override.cleared", {
        userId: row.userId,
        permission: row.permission,
        effect: row.effect,
      });
    });

    await this.invalidator.invalidate(actor.organizationId, row.userId);
  }
}
