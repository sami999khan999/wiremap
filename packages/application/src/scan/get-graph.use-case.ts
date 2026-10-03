import { NotFoundError, type ProjectId, type ScanCounts, type ScanId } from "../import.js";
import type { StorageGateway } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { ScanRepository } from "./scan.repository.js";

export interface GraphLink {
  readonly scanId: ScanId;
  readonly url: string;
  readonly createdAt: Date;
  readonly counts: ScanCounts;
}

// A five-minute signed URL to one scan's graph, the latest succeeded one by default. The
// browser fetches it directly and keeps it by scan id: a graph never changes.
export class GetGraphUseCase {
  private static readonly TTL_SECONDS = 5 * 60;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly scans: ScanRepository,
    private readonly storage: StorageGateway,
  ) {}

  public async execute(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly scanId: ScanId | null },
  ): Promise<GraphLink> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.graph.read",
    );
    const scan = input.scanId
      ? await this.scans.findById(actor.organizationId, input.scanId)
      : await this.scans.latestSucceeded(actor.organizationId, project.id);
    if (
      !scan ||
      scan.projectId !== project.id ||
      scan.state !== "succeeded" ||
      !scan.graphKey ||
      !scan.counts
    ) {
      throw new NotFoundError("graph", input.scanId ?? project.id);
    }
    return {
      scanId: scan.id,
      url: await this.storage.presignDownload(scan.graphKey, GetGraphUseCase.TTL_SECONDS),
      createdAt: scan.finishedAt ?? scan.queuedAt,
      counts: scan.counts,
    };
  }
}
