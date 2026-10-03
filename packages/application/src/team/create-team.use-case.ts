import { ConflictError, NotFoundError, type TeamId, Uuid } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamRecord, TeamRepository } from "./team.repository.js";

export interface CreateTeamInput {
  readonly name: string;
  readonly description: string | null;
}

export class CreateTeamUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly teams: TeamRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: CreateTeamInput): Promise<TeamRecord> {
    this.authorizer.assert(actor, "member.team.manage");

    const name = input.name.trim();
    if (await this.teams.existsByName(actor.organizationId, name)) {
      throw new ConflictError("team", "name");
    }

    const id = Uuid.v7() as TeamId;
    await this.unitOfWork.run(async () => {
      await this.teams.save(actor.organizationId, {
        id,
        name,
        description: input.description || null,
      });
      await this.activity.record(actor, "team.created", { teamId: id, name });
    });

    const saved = await this.teams.findById(actor.organizationId, id);
    if (!saved) throw new NotFoundError("team", id);
    return saved;
  }
}
