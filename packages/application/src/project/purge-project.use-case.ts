import type { OrganizationId, ProjectId } from "../import.js";
import type { StorageGateway } from "../port/index.js";
import type { ProjectRepository } from "./project.repository.js";
import { ProjectRules } from "./project.rules.js";

export interface PurgeProjectInput {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
}

// The `project-delete` job: a deleted project's objects, then its row and every row that
// cascades from it. The audit trail is kept. Safe to replay at any point.
export class PurgeProjectUseCase {
  // One listing is at most a thousand keys; this bounds the walk if deletes stop landing.
  private static readonly MAX_PASSES = 1_000;

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly storage: StorageGateway,
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
    await this.projects.purge(input.organizationId, input.projectId);
    return { objects };
  }
}
