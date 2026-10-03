import type { StorageGateway } from "../port/index.js";
import type { ScanRepository } from "./scan.repository.js";
import { ScanProtocol } from "./scan-protocol.js";
import { type ScanRef, ScanRefs } from "./scan-ref.js";
import type { ScanTokens } from "./scan-tokens.js";

// Where the runner puts the gzipped graph: a presigned PUT, so the bytes go straight to
// storage and never through the web app.
export class UploadScanUseCase {
  private static readonly TTL_SECONDS = 15 * 60;

  public constructor(
    private readonly tokens: ScanTokens,
    private readonly scans: ScanRepository,
    private readonly storage: StorageGateway,
  ) {}

  public async execute(ref: ScanRef, token: string | null): Promise<{ readonly url: string }> {
    const scan = await ScanProtocol.load(this.tokens, this.scans, ref, token, ["running"]);
    const key = ScanRefs.uploadKey(ref.organizationId, scan.projectId, scan.id);
    return {
      url: await this.storage.presignUpload(key, "application/gzip", UploadScanUseCase.TTL_SECONDS),
    };
  }
}
