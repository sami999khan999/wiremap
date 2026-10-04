import {
  type OrganizationId,
  type ScanId,
  type ScanTrigger,
  type UserId,
  Uuid,
  ValidationError,
} from "../import.js";
import type { QueuePublisher, RepositoryProvider } from "../port/index.js";
import { QueueName } from "../primitive/index.js";
import type { ProjectRecord } from "../project/index.js";
import type { ScanRecord, ScanRepository } from "./scan.repository.js";
import type { ScanRunner } from "./scan-runner.js";

export interface QueueScanInput {
  readonly project: ProjectRecord;
  readonly trigger: Exclude<ScanTrigger, "upload">;
  readonly branch: string | null;
  readonly requestedBy: UserId | null;
}

// One queued scan per project at a time: a second request gets the first back. The job on
// `QueueName.SCAN` is what starts the runner, so a GitHub blip is retried, not lost.
export class QueueScanUseCase {
  public constructor(
    private readonly scans: ScanRepository,
    private readonly runner: ScanRunner,
    private readonly provider: RepositoryProvider,
    private readonly queue: QueuePublisher,
  ) {}

  // By organization rather than principal: a push and a schedule tick have no person.
  public async execute(organizationId: OrganizationId, input: QueueScanInput): Promise<ScanRecord> {
    const active = await this.scans.active(organizationId, input.project.id);
    if (active) return active;
    if (!this.runner.configured || !(await this.provider.isConfigured())) {
      throw new ValidationError([{ field: "project", rule: "noRunner" }]);
    }
    if (!input.project.repositories.some((repository) => repository.provider === "github")) {
      throw new ValidationError([{ field: "project", rule: "noRepositories" }]);
    }
    const id = Uuid.v7() as ScanId;
    await this.scans.create(organizationId, {
      id,
      projectId: input.project.id,
      trigger: input.trigger,
      state: "queued",
      branch: input.branch,
      commitSha: null,
      requestedBy: input.requestedBy,
    });
    await this.queue.publish(
      QueueName.SCAN,
      { organizationId, scanId: id },
      { name: "dispatch", jobId: `scan-dispatch.${id}` },
    );
    const created = await this.scans.findById(organizationId, id);
    if (!created) throw new ValidationError([{ field: "scan", rule: "vanished" }]);
    return created;
  }
}
