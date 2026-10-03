import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamPage, TeamRepository } from "./team.repository.js";

export class ListTeamsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly teams: TeamRepository,
  ) {}

  public execute(actor: Principal, page: PaginationQuery): Promise<TeamPage> {
    this.authorizer.assert(actor, "member.read");
    return this.teams.list(actor.organizationId, page);
  }
}
