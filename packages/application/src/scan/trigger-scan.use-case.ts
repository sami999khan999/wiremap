import type { OrganizationId, ProjectId } from "../import.js";
import type { ProjectRepository } from "../project/index.js";
import type { QueueScanUseCase } from "./queue-scan.use-case.js";
import type { ScanRecord } from "./scan.repository.js";

// A scan nobody clicked for: a push to a tracked branch, or a project's schedule coming due.
// Null when the project is gone or cannot be scanned; neither is worth a retry.
export class TriggerScanUseCase {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly queue: QueueScanUseCase,
  ) {}

  public async execute(input: {
    readonly organizationId: OrganizationId;
    readonly projectId: ProjectId;
    readonly trigger: "push" | "schedule";
    readonly branch: string | null;
  }): Promise<ScanRecord | null> {
    const project = await this.projects.findById(input.organizationId, input.projectId);
    if (!project) return null;
    try {
      return await this.queue.execute(input.organizationId, {
        project,
        trigger: input.trigger,
        branch: input.branch,
        requestedBy: null,
      });
    } catch {
      return null;
    }
  }
}
