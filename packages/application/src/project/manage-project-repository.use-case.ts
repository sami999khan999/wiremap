import type { GithubInstallationRepository } from "../github/index.js";
import {
  ConflictError,
  NotFoundError,
  type ProjectId,
  type RepositoryId,
  Uuid,
  ValidationError,
} from "../import.js";
import type { ActivityLogger, RepositoryProvider, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ListAvailableRepositoriesUseCase } from "./list-available-repositories.use-case.js";
import type { ProjectRecord, ProjectRepository } from "./project.repository.js";
import { ProjectAccess } from "./project-access.js";

export type ProjectRepositoryChange =
  | {
      readonly kind: "add";
      readonly projectId: ProjectId;
      readonly externalId: string;
    }
  | {
      readonly kind: "update";
      readonly projectId: ProjectId;
      readonly repositoryId: RepositoryId;
      readonly branches: readonly string[];
      readonly rootPath: string | null;
    }
  | { readonly kind: "remove"; readonly projectId: ProjectId; readonly repositoryId: RepositoryId };

// The three changes to a project's repositories, one use-case: they share the access check,
// the audit shape and the answer, and differ by one repository call.
export class ManageProjectRepositoryUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly installations: GithubInstallationRepository,
    private readonly provider: RepositoryProvider,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, change: ProjectRepositoryChange): Promise<ProjectRecord> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      change.projectId,
      "project.settings.manage",
    );

    if (change.kind === "add") {
      if (project.repositories.some((repository) => repository.externalId === change.externalId)) {
        throw new ConflictError("repository", "already");
      }
      const available = await ListAvailableRepositoriesUseCase.read(
        this.installations,
        this.provider,
        actor.organizationId,
      );
      const found = available.find((repository) => repository.externalId === change.externalId);
      if (!found) throw new ValidationError([{ field: "externalId", rule: "notInstalled" }]);

      await this.unitOfWork.run(async () => {
        await this.projects.addRepository(actor.organizationId, project.id, {
          id: Uuid.v7() as RepositoryId,
          provider: "github",
          externalId: found.externalId,
          fullName: found.fullName,
          defaultBranch: found.defaultBranch,
          private: found.private,
          installationId: found.installationId,
        });
        await this.activity.record(actor, "project.repository.added", {
          projectId: project.id,
          repository: found.fullName,
        });
      });
    } else {
      const repository = project.repositories.find(
        (candidate) => candidate.id === change.repositoryId,
      );
      if (!repository) throw new NotFoundError("repository", change.repositoryId);

      await this.unitOfWork.run(async () => {
        if (change.kind === "update") {
          await this.projects.updateRepository(actor.organizationId, project.id, repository.id, {
            branches: [...new Set(change.branches.map((branch) => branch.trim()).filter(Boolean))],
            rootPath: change.rootPath?.replace(/^\/+|\/+$/g, "") || null,
          });
        } else {
          await this.projects.removeRepository(actor.organizationId, project.id, repository.id);
        }
        await this.activity.record(
          actor,
          change.kind === "update" ? "project.repository.updated" : "project.repository.removed",
          { projectId: project.id, repository: repository.fullName },
        );
      });
    }

    return (await this.projects.findById(actor.organizationId, project.id)) ?? project;
  }
}
