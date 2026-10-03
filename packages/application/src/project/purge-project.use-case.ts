import type { OrganizationId, ProjectId } from "../import.js";
import type { StorageGateway } from "../port/index.js";
import type { ProjectRepository } from "./project.repository.js";
import { ProjectRules } from "./project.rules.js";

export interface ProjectRowSweep {
  removeForProject(organizationId: OrganizationId, projectId: ProjectId): Promise<void>;
}

export interface PurgeProjectInput {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
}

// The `project-delete` job: a deleted project's objects, its tenant rows (scans, views),
// then its catalog row and what cascades from it. The audit trail is kept; replay is safe.
export class PurgeProjectUseCase {
  // One listing is at most a thousand keys; this bounds the walk if deletes stop landing.
  private static readonly MAX_PASSES = 1_000;

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly storage: StorageGateway,
    // Tenant rows that name the project by id only, swept on the tenant's node.
    private readonly tenantRows: readonly ProjectRowSweep[],
  ) {}

  public async execute(input: PurgeProjectInput): Promise<{ readonly objects: number }> {
    let objects = 0;
    const prefix = ProjectRules.storagePrefix(input.organizationId, input.projectId);
    // Objects first: a row purged before its objects would leave keys nothing points at.
    for (let pass = 0; pass < PurgeProjectUseCase.MAX_PASSES; pass += 1) {
      const keys = await this.storage.list(prefix);
      if (keys.length === 0) break;
      for (const key of keys) await this.storage.delete(key);
      objects += keys.length;
    }
    for (const sweep of this.tenantRows)
      await sweep.removeForProject(input.organizationId, input.projectId);
    await this.projects.purge(input.organizationId, input.projectId);
    return { objects };
  }
}
