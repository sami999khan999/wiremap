type WebCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

export class Uuid {
  private constructor() {}

  private static webCrypto(): WebCrypto {
    return (globalThis as unknown as { crypto: WebCrypto }).crypto;
  }

  public static v7(): string {
    const ts = BigInt(Date.now());
    const bytes = Uuid.webCrypto().getRandomValues(new Uint8Array(16));
    for (let i = 0; i < 6; i++) {
      bytes[i] = Number((ts >> BigInt(40 - i * 8)) & 0xffn);
    }

    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // A shape guard for untrusted input, not a version assertion — a v4 minted elsewhere is
  // still an identifier. `[1-8]` is every version RFC 9562 defines; `[89ab]` is the variant.
  public static isValid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
