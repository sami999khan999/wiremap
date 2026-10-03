import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { InvitationLinkPage, InvitationLinkRepository } from "./invitation-link.repository.js";

export class ListInvitationLinksUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly links: InvitationLinkRepository,
  ) {}

  public execute(actor: Principal, page: PaginationQuery): Promise<InvitationLinkPage> {
    this.authorizer.assert(actor, "member.invite");
    return this.links.list(actor.organizationId, page);
  }
}
