import type { GithubInstallationRepository } from "../github/index.js";
import {
  ConflictError,
  type ProjectId,
  type ProjectRole,
  type RepositoryId,
  Uuid,
  ValidationError,
} from "../import.js";
import type {
  ActivityLogger,
  CapabilityInvalidator,
  RepositoryProvider,
  UnitOfWork,
} from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ListAvailableRepositoriesUseCase } from "./list-available-repositories.use-case.js";
import type { ProjectRecord, ProjectRepository } from "./project.repository.js";
import { ProjectRules } from "./project.rules.js";

export interface CreateProjectInput {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visibility: "org" | "restricted";
  readonly defaultRole: ProjectRole;
  readonly repositories: readonly {
    readonly externalId: string;
    readonly fullName: string;
    readonly defaultBranch: string;
    readonly private: boolean;
  }[];
}

// A project and the repositories it reads. Each repository is checked against what the
// tenant's installations can actually read, so a request cannot name someone else's.
export class CreateProjectUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly installations: GithubInstallationRepository,
    private readonly provider: RepositoryProvider,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: CreateProjectInput): Promise<ProjectRecord> {
    this.authorizer.assert(actor, "project.create");

    if (await this.projects.findBySlug(actor.organizationId, input.slug)) {
      throw new ConflictError("project", "slug");
    }

    const available =
      input.repositories.length === 0
        ? []
        : await ListAvailableRepositoriesUseCase.read(
            this.installations,
            this.provider,
            actor.organizationId,
          );
    const chosen = input.repositories.map((wanted) => {
      const found = available.find((repository) => repository.externalId === wanted.externalId);
      if (!found) throw new ValidationError([{ field: "repositories", rule: "notInstalled" }]);
      return found;
    });

    const id = Uuid.v7() as ProjectId;
    await this.unitOfWork.run(async () => {
      await this.projects.save(actor.organizationId, {
        id,
        slug: input.slug,
        name: input.name.trim(),
        description: input.description || null,
        visibility: input.visibility,
        defaultRole: input.defaultRole,
        schedule: "off",
        ignore: ProjectRules.DEFAULT_IGNORE,
        settings: { tsconfigPath: null, workspace: null },
      });
      for (const repository of chosen) {
        await this.projects.addRepository(actor.organizationId, id, {
          id: Uuid.v7() as RepositoryId,
          provider: "github",
          externalId: repository.externalId,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
          installationId: repository.installationId,
        });
      }
      // The creator administers what they made, whatever their organization role grants.
      await this.projects.saveGrant(actor.organizationId, id, {
        userId: actor.userId,
        teamId: null,
        role: "project_admin",
      });
      await this.activity.record(actor, "project.created", {
        projectId: id,
        name: input.name.trim(),
        repositories: chosen.map((repository) => repository.fullName),
      });
    });

    // A new goal is a new key in everyone's capability set.
    await this.capabilities.invalidateOrganization(actor.organizationId);

    const created = await this.projects.findById(actor.organizationId, id);
    if (!created) throw new ConflictError("project", "vanished");
    return created;
  }
}
