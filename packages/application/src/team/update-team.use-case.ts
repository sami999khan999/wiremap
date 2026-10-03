import { ConflictError, NotFoundError, type TeamId } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamRecord, TeamRepository } from "./team.repository.js";

export interface UpdateTeamInput {
  readonly teamId: TeamId;
  readonly name: string;
  readonly description: string | null;
}

export class UpdateTeamUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly teams: TeamRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateTeamInput): Promise<TeamRecord> {
    this.authorizer.assert(actor, "member.team.manage");

    const team = await this.teams.findById(actor.organizationId, input.teamId);
    if (!team) throw new NotFoundError("team", input.teamId);

    const name = input.name.trim();
    if (await this.teams.existsByName(actor.organizationId, name, team.id)) {
      throw new ConflictError("team", "name");
    }

    const description = input.description || null;
    await this.unitOfWork.run(async () => {
      await this.teams.save(actor.organizationId, { id: team.id, name, description });
      await this.activity.record(actor, "team.updated", { teamId: team.id, name });
    });

    return { ...team, name, description };
  }
}
