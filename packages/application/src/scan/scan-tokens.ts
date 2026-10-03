import type { ScanRef } from "./scan-ref.js";

// The callback credential for one scan: an HMAC of its reference under a secret the server
// and the runner workflow share. Nothing about it is stored; the scan's state is the gate.
export abstract class ScanTokens {
  public abstract issue(ref: ScanRef): string;

  public abstract verify(ref: ScanRef, token: string | null): boolean;
}
