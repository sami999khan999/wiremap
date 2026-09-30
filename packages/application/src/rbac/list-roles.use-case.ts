import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { RoleRecord, RoleRepository } from "./role.repository.js";

export interface ListRolesResult {
  readonly items: readonly RoleRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

// The shortest use-case the kit has, and it still goes through `Authorizer.assert()`:
// that call, not the route guard and not the middleware, is the gate.
export class ListRolesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly roles: RoleRepository,
  ) {}

  public async execute(actor: Principal, input: PaginationQuery): Promise<ListRolesResult> {
    this.authorizer.assert(actor, "rbac.role.read");

    // The tenant comes off the principal, never the input: no argument a caller passes
    // can widen this read to another organization.
    const page = await this.roles.list(actor.organizationId, input);

    return { ...page, limit: input.limit, offset: input.offset };
  }
}
