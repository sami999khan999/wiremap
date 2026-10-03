import type { Clock, OrganizationId, ScanId } from "../import.js";
import type { ScanRepository } from "./scan.repository.js";
import type { ScanRunner } from "./scan-runner.js";

// The `scan/dispatch` job: start the runner for a scan still queued. A dispatch that throws
// is retried by the queue; one already started or finished is skipped.
export class DispatchScanUseCase {
  public constructor(
    private readonly scans: ScanRepository,
    private readonly runner: ScanRunner,
    private readonly clock: Clock,
  ) {}

  public async execute(input: {
    readonly organizationId: OrganizationId;
    readonly scanId: ScanId;
  }): Promise<void> {
    const scan = await this.scans.findById(input.organizationId, input.scanId);
    if (scan?.state !== "queued") return;
    if (!this.runner.configured) {
      await this.scans.fail(
        input.organizationId,
        scan.id,
        this.clock.now(),
        "No scan runner is configured.",
      );
      return;
    }
    await this.runner.dispatch(input);
  }
}
