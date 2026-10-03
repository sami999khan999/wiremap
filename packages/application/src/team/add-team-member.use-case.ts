import { ConflictError, NotFoundError, type TeamId, type UserId } from "../import.js";
import type { MemberRepository } from "../member/index.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamRepository } from "./team.repository.js";

export interface TeamMembershipInput {
  readonly teamId: TeamId;
  readonly userId: UserId;
}

export class AddTeamMemberUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly teams: TeamRepository,
    private readonly members: MemberRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: TeamMembershipInput): Promise<void> {
    this.authorizer.assert(actor, "member.team.manage");

    const team = await this.teams.findById(actor.organizationId, input.teamId);
    if (!team) throw new NotFoundError("team", input.teamId);

    // Only this tenant's members: a team is a slice of the organization, never a way in.
    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);
    if (member.deactivated) throw new ConflictError("member", "inactive");

    await this.unitOfWork.run(async () => {
      await this.teams.addMember(actor.organizationId, team.id, member.userId);
      await this.activity.record(actor, "team.member.added", {
        teamId: team.id,
        userId: member.userId,
      });
    });

    await this.capabilities.invalidate(actor.organizationId, member.userId);
  }
}
