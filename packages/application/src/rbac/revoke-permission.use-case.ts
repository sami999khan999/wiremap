import { ForbiddenError, NotFoundError, PermissionRegistry, type RoleId } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityRepository } from "./capability.repository.js";
import type { RoleRecord, RoleRepository } from "./role.repository.js";
import { RoleRules } from "./role.rules.js";

export interface RevokePermissionInput {
  readonly roleId: RoleId;
  readonly permission: string;
}

export class RevokePermissionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly roles: RoleRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    // The plan, so a key it took away stays revocable by an owner who no longer holds it.
    private readonly entitlements: CapabilityRepository,
  ) {}

  public async execute(actor: Principal, input: RevokePermissionInput): Promise<RoleRecord> {
    this.authorizer.assert(actor, "rbac.permission.revoke");

    const role = await this.roles.findById(actor.organizationId, input.roleId);
    if (!role) throw new NotFoundError("role", input.roleId);
    RoleRules.assertEditable(role);

    // Deliberately not checked against the registry, unlike a grant: a row left behind
    // by a renamed permission is exactly the one somebody needs to be able to remove.
    if (!role.permissions.includes(input.permission)) return role;

    // No stripping what you could not grant: a staff role able to revoke would otherwise
    // take platform keys off every other role.
    const permission = input.permission;
    if (PermissionRegistry.instance.isKnown(permission)) {
      const entitlement = await this.entitlements.entitlementFor(actor.organizationId);
      if (entitlement.isEntitled(permission) && !actor.canTenantWide(permission)) {
        throw new ForbiddenError(permission);
      }
    }

    // One row, not the whole set. `save` reconciles against the list read above, so a
    // concurrent grant was undone by a revoke that had never seen it.
    const updated = await this.unitOfWork.run(async () => {
      await this.roles.deletePermission(actor.organizationId, role.id, input.permission);
      await this.activity.record(actor, "role.permission.revoked", {
        roleId: role.id,
        permission: input.permission,
      });

      return this.roles.findById(actor.organizationId, role.id);
    });

    // After the commit, never inside it: a flush while the old row is still the
    // committed one lets a concurrent read put the stale set straight back.
    await this.capabilities.invalidateOrganization(actor.organizationId);

    // The row cannot be gone: the transaction above wrote to it. Falling back keeps the
    // return type honest without a throw for a case the database rules out.
    return updated ?? role;
  }
}
