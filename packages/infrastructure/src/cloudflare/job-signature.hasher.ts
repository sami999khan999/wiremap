import { Buffer, createHmac, timingSafeEqual } from "../import.js";

// Signs and checks the two hops between the web app and the dispatcher Worker. The
// dispatcher re-implements this over WebCrypto; see apps/dispatcher/README.md.
export class JobSignatureHasher {
  private constructor() {}

  public static readonly TIMESTAMP_HEADER = "x-wiremap-timestamp";
  public static readonly SIGNATURE_HEADER = "x-wiremap-signature";

  // A captured request replays only inside this window.
  public static readonly WINDOW_MS = 5 * 60 * 1000;

  public static sign(secret: string, timestamp: number, body: string): string {
    const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return `v1=${mac}`;
  }

  public static headers(secret: string, timestamp: number, body: string): Record<string, string> {
    return {
      [JobSignatureHasher.TIMESTAMP_HEADER]: String(timestamp),
      [JobSignatureHasher.SIGNATURE_HEADER]: JobSignatureHasher.sign(secret, timestamp, body),
    };
  }

  // Constant time over the MAC, and false for anything malformed rather than a throw:
  // the caller answers 401 either way.
  public static verify(
    secret: string,
    timestampHeader: string | null,
    signatureHeader: string | null,
    body: string,
    now: number,
  ): boolean {
    if (!timestampHeader || !signatureHeader) return false;
    const timestamp = Number(timestampHeader);
    if (!Number.isSafeInteger(timestamp)) return false;
    if (Math.abs(now - timestamp) > JobSignatureHasher.WINDOW_MS) return false;

    const expected = Buffer.from(JobSignatureHasher.sign(secret, timestamp, body));
    const actual = Buffer.from(signatureHeader);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
