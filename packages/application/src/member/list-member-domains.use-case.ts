import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { MemberDomainPage, MemberDomainRepository } from "./member-domain.repository.js";

export class ListMemberDomainsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly domains: MemberDomainRepository,
  ) {}

  public execute(actor: Principal, page: PaginationQuery): Promise<MemberDomainPage> {
    this.authorizer.assert(actor, "member.read");
    return this.domains.list(actor.organizationId, page);
  }
}
