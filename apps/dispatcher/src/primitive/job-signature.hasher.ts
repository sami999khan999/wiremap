// The web app's `JobSignatureHasher` over WebCrypto, because a Worker has no `node:crypto`
// without a compatibility flag. Same headers, same `v1=` HMAC-SHA256 of `<ts>.<body>`.
export class JobSignatureHasher {
  private constructor() {}

  public static readonly TIMESTAMP_HEADER = "x-wiremap-timestamp";
  public static readonly SIGNATURE_HEADER = "x-wiremap-signature";
  public static readonly WINDOW_MS = 5 * 60 * 1000;

  public static async sign(secret: string, timestamp: number, body: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
    const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0"));
    return `v1=${hex.join("")}`;
  }

  public static async headers(
    secret: string,
    timestamp: number,
    body: string,
  ): Promise<Record<string, string>> {
    return {
      [JobSignatureHasher.TIMESTAMP_HEADER]: String(timestamp),
      [JobSignatureHasher.SIGNATURE_HEADER]: await JobSignatureHasher.sign(secret, timestamp, body),
    };
  }

  public static async verify(
    secret: string,
    timestampHeader: string | null,
    signatureHeader: string | null,
    body: string,
    now: number,
  ): Promise<boolean> {
    if (!timestampHeader || !signatureHeader) return false;
    const timestamp = Number(timestampHeader);
    if (!Number.isSafeInteger(timestamp)) return false;
    if (Math.abs(now - timestamp) > JobSignatureHasher.WINDOW_MS) return false;
    const expected = await JobSignatureHasher.sign(secret, timestamp, body);
    return JobSignatureHasher.equal(expected, signatureHeader);
  }

  // Constant time over equal lengths; the length itself is public (always 67).
  private static equal(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
      difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
  }
}
