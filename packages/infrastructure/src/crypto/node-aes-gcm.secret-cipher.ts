import { Buffer, createCipheriv, createDecipheriv, randomBytes, SecretCipher } from "../import.js";

// AES-256-GCM with a random 96-bit IV per value. The output is
// `<version>:<iv>:<tag>:<ciphertext>`, base64url; the version picks the key.
export class NodeAesGcmSecretCipher extends SecretCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;

  // `current` encrypts; `keys` holds it and any retired one still needed to decrypt.
  public constructor(
    private readonly current: string,
    keys: Readonly<Record<string, string>>,
  ) {
    super();
    this.keys = new Map(
      Object.entries(keys).map(([version, value]) => {
        const key = Buffer.from(value, value.length === 64 ? "hex" : "base64");
        if (key.length !== 32) throw new Error(`Secret key ${version} is not 32 bytes`);
        return [version, key];
      }),
    );
    if (!this.keys.has(current)) throw new Error(`No secret key for version ${current}`);
  }

  public override encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.current) as Buffer, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [this.current, iv, cipher.getAuthTag(), body]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(":");
  }

  public override decrypt(ciphertext: string): string {
    const [version, iv, tag, body] = ciphertext.split(":");
    const key = version ? this.keys.get(version) : undefined;
    if (!key || !iv || !tag || body === undefined) throw new Error("Unreadable secret");
    // A pinned tag length: without it a truncated tag is accepted, and forging one is easier.
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), {
      authTagLength: 16,
    });
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
