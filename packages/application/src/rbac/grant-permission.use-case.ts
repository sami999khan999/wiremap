import {
  ForbiddenError,
  NotFoundError,
  PermissionRegistry,
  type RoleId,
  ValidationError,
} from "../import.js";
import type { PlatformReader } from "../platform/index.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { RoleRecord, RoleRepository } from "./role.repository.js";
import { RoleRules } from "./role.rules.js";

export interface GrantPermissionInput {
  readonly roleId: RoleId;
  readonly permission: string;
}

// Adding one permission to one role, and refusing to add one the actor does not hold:
// without that, `rbac.permission.grant` is the only key anyone ever needs.
export class GrantPermissionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly roles: RoleRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly platform: PlatformReader,
  ) {}

  public async execute(actor: Principal, input: GrantPermissionInput): Promise<RoleRecord> {
    this.authorizer.assert(actor, "rbac.permission.grant");

    // Narrowed to a `PermissionKey` here, which is what lets `actor.can` be asked about
    // it below — an unrecognised string is a validation failure, not a denial.
    const permission = RoleRules.assertKnownPermission(input.permission);

    // No escalation: nobody holds a wildcard, so this refuses anyone, `owner` included,
    // handing out a key they do not hold themselves.
    if (!actor.can(permission)) throw new ForbiddenError(permission);

    const role = await this.roles.findById(actor.organizationId, input.roleId);
    if (!role) throw new NotFoundError("role", input.roleId);
    RoleRules.assertEditable(role);

    // What the key needs and the role lacks comes with it, each past the same no-escalation
    // check, so a role is never left holding a key it cannot use.
    const keys = PermissionRegistry.instance
      .closure([permission])
      .filter((key) => !role.permissions.includes(key));
    if (keys.length === 0) return role;
    for (const key of keys) if (!actor.can(key)) throw new ForbiddenError(key);

    // A platform key acts only through the platform organization's roles. Anywhere else it
    // grants nothing, and it blocks that tenant's owner from assigning the role.
    const platformKey = keys.some((key) => PermissionRegistry.instance.scopeOf(key) === "platform");
    if (platformKey && actor.organizationId !== (await this.platform.organizationId())) {
      throw new ValidationError([{ field: "permission", rule: "platformOnly" }]);
    }

    // One row per key, not the whole set. `save` reconciles against the list read above, so
    // two concurrent grants each wrote the set the other had not seen and one was lost.
    const updated = await this.unitOfWork.run(async () => {
      for (const key of keys) {
        await this.roles.savePermission(actor.organizationId, role.id, key);
        await this.activity.record(actor, "role.permission.granted", {
          roleId: role.id,
          permission: key,
        });
      }

      // Re-read inside the transaction, so the answer includes a grant that landed
      // between this caller's read and its write rather than silently dropping it.
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
