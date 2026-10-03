import { NotFoundError } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamMembershipInput } from "./add-team-member.use-case.js";
import type { TeamRepository } from "./team.repository.js";

export class RemoveTeamMemberUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly teams: TeamRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: TeamMembershipInput): Promise<void> {
    this.authorizer.assert(actor, "member.team.manage");

    const team = await this.teams.findById(actor.organizationId, input.teamId);
    if (!team) throw new NotFoundError("team", input.teamId);

    await this.unitOfWork.run(async () => {
      await this.teams.removeMember(actor.organizationId, team.id, input.userId);
      await this.activity.record(actor, "team.member.removed", {
        teamId: team.id,
        userId: input.userId,
      });
    });

    await this.capabilities.invalidate(actor.organizationId, input.userId);
  }
}
