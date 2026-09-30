export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  readonly checksum: string;
}

// No bucket, no region, no endpoint — those are adapter configuration. Key layout is
// `<subject>/<yyyy>/<mm>/<uuid>.<ext>`, because lifecycle rules work on prefixes.
export abstract class StorageGateway {
  public abstract put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;

  // The same write for a body that must not be held in memory. The checksum is computed
  // over the stream as it passes, which is what lets an archive be verified.
  public abstract putStream(
    key: string,
    body: AsyncIterable<Uint8Array>,
    contentType: string,
  ): Promise<StoredObject>;
  public abstract get(key: string): Promise<Uint8Array>;

  // The same read for a body that must not be held in memory: a cold month is read by
  // the chunk, never whole.
  public abstract getStream(key: string): AsyncIterable<Uint8Array>;
  public abstract delete(key: string): Promise<void>;
  public abstract exists(key: string): Promise<boolean>;

  // The stored length, or null when there is no object. `exists` answers whether a key
  // is there; this is what lets a caller check the bytes it wrote all arrived.
  public abstract sizeOf(key: string): Promise<number | null>;

  // One page, and the caller picks a prefix narrow enough that one page is the answer.
  // Paging this would be a second method for a case no reader in this system has.
  public abstract list(prefix: string): Promise<readonly string[]>;

  // In the port because "the browser uploads directly" is an architectural choice: the
  // use-case authorizes, then issues the URL.
  public abstract presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string>;

  // Time-limited. Never a permanent public URL.
  public abstract presignDownload(key: string, expiresInSeconds: number): Promise<string>;
}
