import type { ProjectId } from "../import.js";
import type { ActivityLogger } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { QueueScanUseCase } from "./queue-scan.use-case.js";
import type { ScanRecord } from "./scan.repository.js";

// "Scan now", for someone holding `project.scan.run` on the project.
export class RunScanUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly queue: QueueScanUseCase,
    private readonly activity: ActivityLogger,
  ) {}

  public async execute(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly branch: string | null },
  ): Promise<ScanRecord> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.scan.run",
    );
    const scan = await this.queue.execute(actor.organizationId, {
      project,
      trigger: "manual",
      branch: input.branch,
      requestedBy: actor.userId,
    });
    await this.activity.record(actor, "scan.requested", { projectId: project.id, scanId: scan.id });
    return scan;
  }
}
