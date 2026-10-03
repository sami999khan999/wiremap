import {
  Buffer,
  createHmac,
  type ScanRef,
  ScanRefs,
  ScanTokens,
  timingSafeEqual,
} from "../import.js";

// base64url(HMAC-SHA256(secret, "scan:<ref>")), which the workflow derives with `openssl`:
// its only input is the reference, never a credential. See docs/infra/scan-runner.md.
export class HmacScanTokens extends ScanTokens {
  public constructor(private readonly secret: string) {
    super();
  }

  public override issue(ref: ScanRef): string {
    return createHmac("sha256", this.secret)
      .update(`scan:${ScanRefs.format(ref)}`)
      .digest("base64url");
  }

  public override verify(ref: ScanRef, token: string | null): boolean {
    if (!token) return false;
    const expected = Buffer.from(this.issue(ref));
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
