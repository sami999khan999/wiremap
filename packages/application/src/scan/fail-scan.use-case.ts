import type { Clock } from "../import.js";
import type { DomainEventPublisher, UnitOfWork } from "../port/index.js";
import type { Principal } from "../primitive/index.js";
import type { ScanRepository } from "./scan.repository.js";
import { ScanProtocol } from "./scan-protocol.js";
import type { ScanRef } from "./scan-ref.js";
import type { ScanTokens } from "./scan-tokens.js";

// The runner reporting its own failure. The message is the runner's words, capped: it is
// shown to every reader of the project, so the runner keeps paths out of it.
export class FailScanUseCase {
  private static readonly MAX_ERROR = 500;

  public constructor(
    private readonly tokens: ScanTokens,
    private readonly scans: ScanRepository,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actor: Principal,
    ref: ScanRef,
    token: string | null,
    error: string,
  ): Promise<void> {
    const scan = await ScanProtocol.load(this.tokens, this.scans, ref, token, [
      "queued",
      "running",
    ]);
    const message = error.trim().slice(0, FailScanUseCase.MAX_ERROR) || "The scan failed.";
    await this.unitOfWork.run(async () => {
      if (!(await this.scans.fail(ref.organizationId, scan.id, this.clock.now(), message))) return;
      await this.events.publish(actor, {
        name: "scan.failed",
        payload: {
          projectId: scan.projectId,
          scanId: scan.id,
          trigger: scan.trigger,
          requestedBy: scan.requestedBy,
          error: message,
        },
      });
    });
  }
}
