import type { Clock, OrganizationId } from "../import.js";
import type { DomainEventPublisher } from "../port/index.js";
import type { Principal } from "../primitive/index.js";
import type { ScanRepository, SweptScan } from "./scan.repository.js";

// The hourly tick's sweep, once per node: a scan queued or running for over half an hour
// is failed, so a runner that died never leaves a project's "scan now" stuck behind it.
export class SweepScansUseCase {
  private static readonly STALE_MS = 30 * 60 * 1000;
  private static readonly MESSAGE = "The scan did not finish within 30 minutes.";

  public constructor(
    private readonly scans: ScanRepository,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actorFor: (organizationId: OrganizationId) => Principal,
  ): Promise<readonly SweptScan[]> {
    const now = this.clock.now();
    const swept = await this.scans.failStale(
      new Date(now.getTime() - SweepScansUseCase.STALE_MS),
      now,
      SweepScansUseCase.MESSAGE,
    );
    for (const scan of swept) {
      await this.events.publish(actorFor(scan.organizationId), {
        name: "scan.failed",
        payload: {
          projectId: scan.projectId,
          scanId: scan.id,
          trigger: scan.trigger,
          requestedBy: scan.requestedBy,
          error: SweepScansUseCase.MESSAGE,
        },
      });
    }
    return swept;
  }
}
