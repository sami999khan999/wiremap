import { ConflictError, type RoleId, Uuid } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { RoleRecord, RoleRepository } from "./role.repository.js";
import { RoleRules } from "./role.rules.js";

export interface CreateRoleInput {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly scope: "org" | "goal";
}

// A new role starts with no permissions. Granting is a separate key, so a product can
// let someone organise roles without letting them widen one.
export class CreateRoleUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly roles: RoleRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: CreateRoleInput): Promise<RoleRecord> {
    this.authorizer.assert(actor, "rbac.role.manage");

    // Before the uniqueness check, because the seeded rows may not exist yet in a
    // fresh tenant and `owner` would then be free to take.
    if (RoleRules.isReservedKey(input.key)) throw new ConflictError("role", "reserved");

    const existing = await this.roles.findByKey(actor.organizationId, input.key);
    if (existing) throw new ConflictError("role", "duplicate");

    const role: RoleRecord = {
      id: Uuid.v7() as RoleId,
      key: input.key,
      name: input.name,
      description: input.description,
      scope: input.scope,
      isSystem: false,
      permissions: [],
    };

    await this.unitOfWork.run(async () => {
      await this.roles.save(actor.organizationId, role);
      await this.activity.record(actor, "role.created", { roleId: role.id, key: role.key });
    });

    // No cache invalidation: a role nobody holds is in nobody's resolved set.
    return role;
  }
}
