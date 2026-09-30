import { NotFoundError, StorageGateway, type StoredObject } from "../import.js";

interface StoredEntry {
  readonly body: Uint8Array;
  readonly contentType: string;
}

// Bytes in a Map. `presign*` returns a fake URL rather than throwing, because a
// use-case that issues one and returns it should be testable without S3.
export class InMemoryStorageGateway extends StorageGateway {
  private readonly objects = new Map<string, StoredEntry>();

  public override put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve({
      key,
      size: body.byteLength,
      contentType,
      // Not a real digest. Deterministic and unique per key, which is all an
      // assertion needs — computing sha256 here would test the fake.
      checksum: `fake-${key}`,
    });
  }

  // Collects the stream and stores it like any other body, so a test can assert on the
  // bytes a caller streamed without standing up S3.
  public override async *getStream(key: string): AsyncGenerator<Uint8Array> {
    yield await this.get(key);
  }

  public override async putStream(
    key: string,
    body: AsyncIterable<Uint8Array>,
    contentType: string,
  ): Promise<StoredObject> {
    const chunks: Uint8Array[] = [];
    let size = 0;

    for await (const chunk of body) {
      chunks.push(chunk);
      size += chunk.byteLength;
    }

    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    this.objects.set(key, { body: joined, contentType });
    return { key, size, contentType, checksum: `fake-${key}` };
  }

  // `NotFoundError`, like `S3StorageGateway` — a bare `Error` here lets a caller's
  // catch-by-code branch pass against the fake and fail against S3.
  public override get(key: string): Promise<Uint8Array> {
    const entry = this.objects.get(key);
    if (!entry) return Promise.reject(new NotFoundError("storage.object", key));
    return Promise.resolve(entry.body);
  }

  public override delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  public override sizeOf(key: string): Promise<number | null> {
    return Promise.resolve(this.objects.get(key)?.body.byteLength ?? null);
  }

  public override exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  // Sorted, because S3 returns a page in lexicographic order and a fake that returned
  // insertion order would let a caller depending on the wrong one pass.
  public override list(prefix: string): Promise<readonly string[]> {
    return Promise.resolve([...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort());
  }

  public override presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return Promise.resolve(
      `https://fake.storage/put/${key}?type=${encodeURIComponent(contentType)}&expires=${expiresInSeconds}`,
    );
  }

  public override presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(`https://fake.storage/get/${key}?expires=${expiresInSeconds}`);
  }

  public keys(): readonly string[] {
    return [...this.objects.keys()];
  }
}
