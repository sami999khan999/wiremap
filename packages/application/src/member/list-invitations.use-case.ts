import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { InvitationRecord, InvitationRepository } from "./invitation.repository.js";

export interface ListInvitationsResult {
  readonly items: readonly InvitationRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

// Gated on `member.read`, not `member.invite`: seeing who has been asked in is part of
// seeing who is in.
export class ListInvitationsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly invitations: InvitationRepository,
  ) {}

  public async execute(actor: Principal, input: PaginationQuery): Promise<ListInvitationsResult> {
    this.authorizer.assert(actor, "member.read");

    const page = await this.invitations.list(actor.organizationId, input);

    return { ...page, limit: input.limit, offset: input.offset };
  }
}
