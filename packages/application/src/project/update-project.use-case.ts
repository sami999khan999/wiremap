import type { ProjectId, ProjectRole } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ProjectRecord, ProjectRepository } from "./project.repository.js";
import { ProjectAccess } from "./project-access.js";

export interface UpdateProjectInput {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: "org" | "restricted";
  readonly defaultRole: ProjectRole;
  readonly schedule: "off" | "daily" | "weekly";
  readonly ignore: readonly string[];
  readonly settings: { readonly tsconfigPath: string | null; readonly workspace: string | null };
}

export class UpdateProjectUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateProjectInput): Promise<ProjectRecord> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.settings.manage",
    );
    // Visibility and the default role decide everyone's reach, so they need the access key too.
    if (input.visibility !== project.visibility || input.defaultRole !== project.defaultRole) {
      this.authorizer.assert(actor, "project.access.manage", project.id);
    }

    const ignore = [...new Set(input.ignore.map((pattern) => pattern.trim()).filter(Boolean))];
    await this.unitOfWork.run(async () => {
      await this.projects.save(actor.organizationId, {
        id: project.id,
        slug: project.slug,
        name: input.name.trim(),
        description: input.description || null,
        visibility: input.visibility,
        defaultRole: input.defaultRole,
        schedule: input.schedule,
        ignore,
        settings: input.settings,
      });
      await this.activity.record(actor, "project.updated", { projectId: project.id });
    });

    if (input.visibility !== project.visibility || input.defaultRole !== project.defaultRole) {
      await this.capabilities.invalidateOrganization(actor.organizationId);
    }

    return (await this.projects.findById(actor.organizationId, project.id)) ?? project;
  }
}
