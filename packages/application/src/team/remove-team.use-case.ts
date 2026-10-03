import { NotFoundError, type TeamId } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamRepository } from "./team.repository.js";

export class RemoveTeamUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly teams: TeamRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: { readonly teamId: TeamId }): Promise<void> {
    this.authorizer.assert(actor, "member.team.manage");

    const team = await this.teams.findById(actor.organizationId, input.teamId);
    if (!team) throw new NotFoundError("team", input.teamId);

    await this.unitOfWork.run(async () => {
      await this.teams.delete(actor.organizationId, team.id);
      await this.activity.record(actor, "team.deleted", { teamId: team.id, name: team.name });
    });

    // A team's project grants left with it, and its members are not listed here.
    await this.capabilities.invalidateOrganization(actor.organizationId);
  }
}
