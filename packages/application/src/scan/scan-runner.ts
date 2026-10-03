import type { ScanRef } from "./scan-ref.js";

// Where a scan's analysis runs: a GitHub Actions workflow in production, a child process
// in development. It only starts the run; the runner calls back over the scan protocol.
export abstract class ScanRunner {
  // False when nothing is configured: a scan is then refused before it is queued.
  public abstract readonly configured: boolean;

  public abstract dispatch(ref: ScanRef): Promise<void>;
}
