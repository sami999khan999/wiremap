import type { Clock } from "../import.js";
import type { DomainEventPublisher, UnitOfWork } from "../port/index.js";
import type { Principal } from "../primitive/index.js";
import { FindingRules } from "./finding-rules.js";
import type { GraphArchive } from "./graph-archive.js";
import type { ScanRepository } from "./scan.repository.js";
import { ScanProtocol } from "./scan-protocol.js";
import { type ScanRef, ScanRefs } from "./scan-ref.js";
import type { ScanTokens } from "./scan-tokens.js";

// The runner's last call. The server reads the graph back itself, so what Postgres records
// is what the file says, not what the runner claims; a graph it refuses fails the scan.
export class CompleteScanUseCase {
  // Beyond this many new findings in one scan, one event each is noise: the rest are in
  // the scan's counts and the insights page.
  private static readonly MAX_FINDING_EVENTS = 50;

  public constructor(
    private readonly tokens: ScanTokens,
    private readonly scans: ScanRepository,
    private readonly archive: GraphArchive,
    private readonly events: DomainEventPublisher,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actor: Principal,
    ref: ScanRef,
    token: string | null,
  ): Promise<{ readonly state: "succeeded" | "failed" }> {
    const scan = await ScanProtocol.load(this.tokens, this.scans, ref, token, ["running"]);
    const key = ScanRefs.graphKey(ref.organizationId, scan.projectId, scan.id);
    const read = await this.archive.read(key);
    const base = {
      projectId: scan.projectId,
      scanId: scan.id,
      trigger: scan.trigger,
      requestedBy: scan.requestedBy,
    };

    if ("refused" in read) {
      await this.unitOfWork.run(async () => {
        if (await this.scans.fail(ref.organizationId, scan.id, this.clock.now(), read.refused)) {
          await this.events.publish(actor, {
            name: "scan.failed",
            payload: { ...base, error: read.refused },
          });
        }
      });
      return { state: "failed" };
    }

    const findings = FindingRules.diff(
      await this.scans.openFindings(ref.organizationId, scan.projectId),
      FindingRules.findings(read.document),
    );
    await this.unitOfWork.run(async () => {
      const moved = await this.scans.succeed(ref.organizationId, scan.id, {
        at: this.clock.now(),
        graphKey: key,
        graphBytes: read.bytes,
        counts: FindingRules.counts(read.document),
        analyzerVersion: read.document.meta.analyzer,
        commitSha: read.document.meta.repositories[0]?.commit ?? scan.commitSha,
      });
      if (!moved) return;
      await this.scans.replaceFindings(ref.organizationId, scan.projectId, scan.id, findings);
      await this.events.publish(actor, {
        name: "scan.succeeded",
        payload: { ...base, newFindings: findings.added.length },
      });
      for (const finding of findings.added.slice(0, CompleteScanUseCase.MAX_FINDING_EVENTS)) {
        await this.events.publish(actor, {
          name: "finding.created",
          payload: {
            projectId: scan.projectId,
            scanId: scan.id,
            kind: finding.kind,
            key: finding.key,
          },
        });
      }
    });
    return { state: "succeeded" };
  }
}
