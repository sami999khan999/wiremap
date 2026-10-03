import type { ProjectId, ProjectRole, UserId } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ProjectRecord, ProjectRepository, ReachMember } from "./project.repository.js";
import { ProjectRules } from "./project.rules.js";

export interface ProjectAccessCell {
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly role: ProjectRole;
  readonly via: "organization" | "default" | "direct" | "team";
  readonly teamName: string | null;
}

export interface ProjectAccessOverview {
  readonly projects: readonly Pick<
    ProjectRecord,
    "id" | "slug" | "name" | "visibility" | "defaultRole"
  >[];
  readonly members: readonly Omit<ReachMember, "orgWide">[];
  readonly cells: readonly ProjectAccessCell[];
}

// Who can open what, for the whole tenant. The same rules the capability read applies,
// folded in memory: highest role wins, a viewer is capped, an org-wide role reads all.
export class GetProjectAccessOverviewUseCase {
  // When two sources give the same role, the one shown is the most specific.
  private static readonly SPECIFICITY = { direct: 0, team: 1, default: 2 } as const;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
  ) {}

  public async execute(actor: Principal): Promise<ProjectAccessOverview> {
    this.authorizer.assert(actor, "project.access.overview");
    const [projects, reach] = await Promise.all([
      this.projects.listAll(actor.organizationId),
      this.projects.reach(actor.organizationId),
    ]);

    const roleOf = new Map(reach.members.map((member) => [member.userId, member.roleKey]));
    const best = new Map<string, ProjectAccessCell>();
    for (const source of reach.sources) {
      const roleKey = roleOf.get(source.userId);
      if (roleKey === undefined) continue;
      const cell: ProjectAccessCell = {
        ...source,
        role: ProjectRules.capped(source.role, roleKey),
      };
      const key = `${source.projectId}:${source.userId}`;
      const held = best.get(key);
      if (!held || GetProjectAccessOverviewUseCase.outranks(cell, held)) best.set(key, cell);
    }

    // An organization role that reads every project beats any grant, and says so.
    for (const member of reach.members) {
      if (!member.orgWide) continue;
      for (const project of projects) {
        best.set(`${project.id}:${member.userId}`, {
          projectId: project.id,
          userId: member.userId,
          role: "project_admin",
          via: "organization",
          teamName: null,
        });
      }
    }

    return {
      projects: projects.map(({ id, slug, name, visibility, defaultRole }) => ({
        id,
        slug,
        name,
        visibility,
        defaultRole,
      })),
      members: reach.members.map(({ orgWide: _orgWide, ...member }) => member),
      cells: [...best.values()],
    };
  }

  private static outranks(candidate: ProjectAccessCell, held: ProjectAccessCell): boolean {
    if (candidate.role !== held.role) {
      return ProjectRules.higher(candidate.role, held.role) === candidate.role;
    }
    const order = GetProjectAccessOverviewUseCase.SPECIFICITY;
    return order[candidate.via as keyof typeof order] < order[held.via as keyof typeof order];
  }
}
