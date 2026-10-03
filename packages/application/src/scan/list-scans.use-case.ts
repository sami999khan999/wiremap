import type { PaginationQuery, ProjectId } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { ScanRecord, ScanRepository } from "./scan.repository.js";

export class ListScansUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly scans: ScanRepository,
  ) {}

  public async execute(
    actor: Principal,
    input: PaginationQuery & { readonly projectId: ProjectId },
  ): Promise<{ readonly items: readonly ScanRecord[]; readonly total: number }> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.graph.read",
    );
    return this.scans.list(actor.organizationId, project.id, {
      limit: input.limit,
      offset: input.offset,
    });
  }
}
