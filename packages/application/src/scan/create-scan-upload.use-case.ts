import { NotFoundError, type ScanId, Uuid } from "../import.js";
import type { ActivityLogger, StorageGateway } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { ScanRepository } from "./scan.repository.js";
import { ScanRefs } from "./scan-ref.js";
import type { ScanTokens } from "./scan-tokens.js";

export interface ScanUpload {
  readonly scanId: ScanId;
  readonly ref: string;
  readonly token: string;
  readonly uploadUrl: string;
  readonly completeUrl: string;
}

// The CLI's path for a graph built where the GitHub App cannot reach: a running scan, a
// presigned PUT for the file, and the same completion call a runner makes.
export class CreateScanUploadUseCase {
  private static readonly TTL_SECONDS = 15 * 60;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly scans: ScanRepository,
    private readonly tokens: ScanTokens,
    private readonly storage: StorageGateway,
    private readonly activity: ActivityLogger,
    private readonly baseUrl: string,
  ) {}

  public async execute(
    actor: Principal,
    input: {
      readonly project: string;
      readonly branch: string | null;
      readonly commitSha: string | null;
    },
  ): Promise<ScanUpload> {
    const found = await this.projects.findBySlug(actor.organizationId, input.project);
    if (!found) throw new NotFoundError("project", input.project);
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      found.id,
      "project.scan.run",
    );
    const id = Uuid.v7() as ScanId;
    await this.scans.create(actor.organizationId, {
      id,
      projectId: project.id,
      trigger: "upload",
      state: "running",
      branch: input.branch,
      commitSha: input.commitSha,
      requestedBy: actor.userId,
    });
    await this.activity.record(actor, "scan.uploaded", { projectId: project.id, scanId: id });
    const ref = { organizationId: actor.organizationId, scanId: id };
    const formatted = ScanRefs.format(ref);
    return {
      scanId: id,
      ref: formatted,
      token: this.tokens.issue(ref),
      uploadUrl: await this.storage.presignUpload(
        ScanRefs.uploadKey(actor.organizationId, project.id, id),
        "application/gzip",
        CreateScanUploadUseCase.TTL_SECONDS,
      ),
      completeUrl: `${this.baseUrl.replace(/\/$/, "")}/api/scan/${formatted}/complete`,
    };
  }
}
