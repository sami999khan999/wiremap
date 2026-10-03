import { createHmac, StorageGateway, type StoredObject, timingSafeEqual } from "../import.js";

export type ProxiedMethod = "GET" | "PUT";

// Every link the bucket would have presigned is a URL on the web app instead, signed here and
// verified by `/api/storage/`. See docs/reference/storage-access.md.
export class ProxiedStorageGateway extends StorageGateway {
  public static readonly ROUTE = "/api/storage/";

  public constructor(
    private readonly inner: StorageGateway,
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  public override put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    return this.inner.put(key, body, contentType);
  }

  public override putStream(
    key: string,
    body: AsyncIterable<Uint8Array>,
    contentType: string,
  ): Promise<StoredObject> {
    return this.inner.putStream(key, body, contentType);
  }

  public override get(key: string): Promise<Uint8Array> {
    return this.inner.get(key);
  }

  public override getStream(key: string): AsyncIterable<Uint8Array> {
    return this.inner.getStream(key);
  }

  public override delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  public override exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }

  public override sizeOf(key: string): Promise<number | null> {
    return this.inner.sizeOf(key);
  }

  public override list(prefix: string): Promise<readonly string[]> {
    return this.inner.list(prefix);
  }

  public override presignUpload(
    key: string,
    _contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return Promise.resolve(this.link("PUT", key, expiresInSeconds));
  }

  public override presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(this.link("GET", key, expiresInSeconds));
  }

  // True only for the method, key and expiry the link was signed for, before it expires.
  public verify(
    method: ProxiedMethod,
    key: string,
    expires: string | null,
    signature: string | null,
  ): boolean {
    if (!expires || !signature || !/^\d{1,12}$/.test(expires)) return false;
    if (Number(expires) * 1000 < this.now()) return false;
    const expected = Buffer.from(this.sign(method, key, expires));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private link(method: ProxiedMethod, key: string, expiresInSeconds: number): string {
    const expires = String(Math.floor(this.now() / 1000) + expiresInSeconds);
    const path = key.split("/").map(encodeURIComponent).join("/");
    const query = `exp=${expires}&sig=${this.sign(method, key, expires)}`;
    return `${this.baseUrl.replace(/\/+$/, "")}${ProxiedStorageGateway.ROUTE}${path}?${query}`;
  }

  private sign(method: ProxiedMethod, key: string, expires: string): string {
    return createHmac("sha256", this.secret)
      .update(`${method}\n${key}\n${expires}`)
      .digest("base64url");
  }
}
