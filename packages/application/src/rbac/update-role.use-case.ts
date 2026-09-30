import { NotFoundError, type RoleId } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { RoleRecord, RoleRepository } from "./role.repository.js";
import { RoleRules } from "./role.rules.js";

export interface UpdateRoleInput {
  readonly roleId: RoleId;
  readonly name: string;
  readonly description: string | null;
}

// Renaming, and nothing else. The key is what `MemberRules.OWNER_KEY` and every seeded
// row are matched on, and the grants belong to two other permissions.
export class UpdateRoleUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly roles: RoleRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateRoleInput): Promise<RoleRecord> {
    this.authorizer.assert(actor, "rbac.role.manage");

    const role = await this.roles.findById(actor.organizationId, input.roleId);
    if (!role) throw new NotFoundError("role", input.roleId);
    RoleRules.assertEditable(role);

    const updated: RoleRecord = { ...role, name: input.name, description: input.description };

    await this.unitOfWork.run(async () => {
      await this.roles.save(actor.organizationId, updated);
      await this.activity.record(actor, "role.updated", { roleId: role.id, name: input.name });
    });

    // No cache invalidation: a label is not a capability, and flushing a tenant to
    // change one would make every rename cost every session a re-resolve.
    return updated;
  }
}
