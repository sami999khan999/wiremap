type WebCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
};

// Declared rather than named, like `crypto` below: `lib: ["ES2024"]` has neither, and
// adding a DOM or Node lib to borrow one method would bind this package to a runtime.
type Encoder = new () => { encode(input: string): Uint8Array };

// An opaque random string for anything unguessable, and the digest of one. Here rather
// than beside `ApiKeyHasher` because `application` cannot reach `auth`.
export class Token {
  private constructor() {}

  public static random(bytes = 32): string {
    const buffer = Token.crypto().getRandomValues(new Uint8Array(bytes));
    return Token.hex(buffer);
  }

  // Store this, never the token. A dump then holds no usable credential, and the
  // digest is what a lookup is keyed on.
  public static async hash(value: string): Promise<string> {
    const encoded = new (globalThis as unknown as { TextEncoder: Encoder }).TextEncoder().encode(
      value,
    );
    return Token.hex(new Uint8Array(await Token.crypto().subtle.digest("SHA-256", encoded)));
  }

  // Reached off `globalThis` for the same reason `Uuid` does: `lib: ["ES2024"]` declares
  // no `crypto`, and this package has to load in every runtime.
  private static crypto(): WebCrypto {
    return (globalThis as unknown as { crypto: WebCrypto }).crypto;
  }

  private static hex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}
