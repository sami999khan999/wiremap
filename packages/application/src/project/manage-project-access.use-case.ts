import {
  NotFoundError,
  type ProjectGrantId,
  type ProjectId,
  type ProjectRole,
  type TeamId,
  type UserId,
  ValidationError,
} from "../import.js";
import type { MemberRepository } from "../member/index.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { TeamRepository } from "../team/index.js";
import type { ProjectGrantRecord, ProjectRepository } from "./project.repository.js";
import { ProjectAccess } from "./project-access.js";

export type ProjectAccessChange =
  | { readonly kind: "list"; readonly projectId: ProjectId }
  | {
      readonly kind: "save";
      readonly projectId: ProjectId;
      readonly userId: UserId | null;
      readonly teamId: TeamId | null;
      readonly role: ProjectRole;
    }
  | { readonly kind: "revoke"; readonly projectId: ProjectId; readonly grantId: ProjectGrantId };

// Who may see a project beyond its default. A grant names a member or a team of this tenant,
// never anyone else; the capability read applies it at the next request.
export class ManageProjectAccessUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly members: MemberRepository,
    private readonly teams: TeamRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(
    actor: Principal,
    change: ProjectAccessChange,
  ): Promise<readonly ProjectGrantRecord[]> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      change.projectId,
      "project.access.manage",
    );

    if (change.kind === "save") {
      // Exactly one of the two, which the table enforces too.
      if ((change.userId === null) === (change.teamId === null)) {
        throw new ValidationError([{ field: "userId", rule: "oneOf" }]);
      }
      if (change.userId && !(await this.members.findByUser(actor.organizationId, change.userId))) {
        throw new NotFoundError("member", change.userId);
      }
      if (change.teamId && !(await this.teams.findById(actor.organizationId, change.teamId))) {
        throw new NotFoundError("team", change.teamId);
      }
      await this.unitOfWork.run(async () => {
        await this.projects.saveGrant(actor.organizationId, project.id, change);
        await this.activity.record(actor, "project.access.granted", {
          projectId: project.id,
          userId: change.userId,
          teamId: change.teamId,
          role: change.role,
        });
      });
      await this.capabilities.invalidateOrganization(actor.organizationId);
    }

    if (change.kind === "revoke") {
      await this.unitOfWork.run(async () => {
        await this.projects.revokeGrant(actor.organizationId, project.id, change.grantId);
        await this.activity.record(actor, "project.access.revoked", {
          projectId: project.id,
          grantId: change.grantId,
        });
      });
      await this.capabilities.invalidateOrganization(actor.organizationId);
    }

    return this.projects.grants(actor.organizationId, project.id);
  }
}
