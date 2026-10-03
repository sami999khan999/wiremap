import { NotFoundError, type ScanState, UnauthorizedError } from "../import.js";
import type { ScanRecord, ScanRepository } from "./scan.repository.js";
import type { ScanRef } from "./scan-ref.js";
import type { ScanTokens } from "./scan-tokens.js";

// Every runner callback's first check: this scan's token, in a state the step accepts. A
// finished scan refuses everything, so a captured token is worthless once the run is over.
export class ScanProtocol {
  private constructor() {}

  public static async load(
    tokens: ScanTokens,
    scans: ScanRepository,
    ref: ScanRef,
    token: string | null,
    states: readonly ScanState[],
  ): Promise<ScanRecord> {
    if (!tokens.verify(ref, token)) throw new UnauthorizedError("scan-token");
    const scan = await scans.findById(ref.organizationId, ref.scanId);
    if (!scan || !states.includes(scan.state)) throw new NotFoundError("scan", ref.scanId);
    return scan;
  }
}
