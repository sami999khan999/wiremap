import { NotFoundError, type TeamId } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamMemberRecord, TeamRepository } from "./team.repository.js";

export class ListTeamMembersUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly teams: TeamRepository,
  ) {}

  public async execute(
    actor: Principal,
    input: { readonly teamId: TeamId },
  ): Promise<readonly TeamMemberRecord[]> {
    this.authorizer.assert(actor, "member.read");
    const team = await this.teams.findById(actor.organizationId, input.teamId);
    if (!team) throw new NotFoundError("team", input.teamId);
    return this.teams.members(actor.organizationId, team.id);
  }
}
