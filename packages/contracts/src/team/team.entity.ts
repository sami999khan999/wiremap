import { TeamContract, type TeamDto } from "./team.contract.js";

export class TeamEntity {
  private constructor(private readonly dto: TeamDto) {}

  public static from(dto: TeamDto): TeamEntity {
    return new TeamEntity(TeamContract.entity.parse(dto));
  }

  public get id(): TeamDto["id"] {
    return this.dto.id;
  }

  public get label(): string {
    return this.dto.name;
  }

  public get empty(): boolean {
    return this.dto.memberCount === 0;
  }
}
