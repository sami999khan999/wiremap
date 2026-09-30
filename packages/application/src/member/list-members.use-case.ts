import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { MemberRecord, MemberRepository } from "./member.repository.js";

export interface ListMembersResult {
  readonly items: readonly MemberRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

// The same shape as `ListRolesUseCase`, for the same reason: the assert is the gate,
// and the tenant comes off the principal and never off the input.
export class ListMembersUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
  ) {}

  public async execute(actor: Principal, input: PaginationQuery): Promise<ListMembersResult> {
    this.authorizer.assert(actor, "member.read");

    const page = await this.members.list(actor.organizationId, input);

    return { ...page, limit: input.limit, offset: input.offset };
  }
}
