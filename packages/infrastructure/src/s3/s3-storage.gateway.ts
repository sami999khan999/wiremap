import {
  Buffer,
  type ColdTier,
  createHash,
  DeleteObjectCommand,
  GetObjectCommand,
  getSignedUrl,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFoundError,
  PutObjectCommand,
  Readable,
  type S3Client,
  StorageGateway,
  type StoredObject,
  Upload,
} from "../import.js";
import { S3ClientFactory } from "./s3-client.factory.js";

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  // true for MinIO, false for AWS.
  readonly forcePathStyle: boolean;
  // Absent is no colder class, which is every deployment until someone pays for one.
  readonly coldTier?: ColdTier;
}

interface Digest {
  readonly hex: string;
  readonly base64: string;
}

export class S3StorageGateway extends StorageGateway {
  private readonly s3: S3Client;

  public constructor(private readonly config: S3Config) {
    super();
    this.s3 = S3ClientFactory.create(config);
  }

  public override async put(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<StoredObject> {
    const digest = await S3StorageGateway.sha256(body);

    // S3 verifies the checksum server-side and rejects a corrupt transfer rather
    // than silently storing truncated bytes.
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: digest.base64,
      }),
    );

    return { key, size: body.byteLength, contentType, checksum: digest.hex };
  }

  public override async putStream(
    key: string,
    body: AsyncIterable<Uint8Array>,
    contentType: string,
  ): Promise<StoredObject> {
    const hash = createHash("sha256");
    let size = 0;

    // Taken as the bytes go past, because a generator has no second pass — which is also
    // why `ChecksumSHA256` is not sent here: `Upload` checksums each part instead.
    async function* tapped(): AsyncGenerator<Uint8Array> {
      for await (const chunk of body) {
        hash.update(chunk);
        size += chunk.byteLength;
        yield chunk;
      }
    }

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: Readable.from(tapped()),
        ContentType: contentType,
      },
      // 8 MiB parts, four in flight. S3's floor is 5 MiB for every part but the last,
      // and the ceiling is 10 000 parts — 8 MiB puts the practical limit near 80 GB.
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
    });

    await upload.done();

    return { key, size, contentType, checksum: hash.digest("hex") };
  }

  public override async get(key: string): Promise<Uint8Array> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!result.Body) throw new NotFoundError("storage.object", key);
    return new Uint8Array(await result.Body.transformToByteArray());
  }

  // The SDK's body is a Node `Readable` on this runtime, which is an async iterable of
  // chunks — so the object is never assembled here.
  public override async *getStream(key: string): AsyncGenerator<Uint8Array> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!result.Body) throw new NotFoundError("storage.object", key);
    yield* result.Body as unknown as AsyncIterable<Uint8Array>;
  }

  public override async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  public override async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  // `ContentLength` off the same `HEAD`. A multipart upload that lost a part still
  // answers that head, which is why existence alone proved nothing about the bytes.
  public override async sizeOf(key: string): Promise<number | null> {
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  // `ListObjectsV2` returns up to a thousand keys and this asks for no more: the one
  // reader is a tenant's exports, which is nine objects a day for seven days.
  public override async list(prefix: string): Promise<readonly string[]> {
    const response = await this.s3.send(
      new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix }),
    );

    return (response.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []));
  }

  // Expiry is the caller's, not the gateway's: a link in an email needs longer than
  // one rendered in a live UI, and that is a use-case decision.
  public override async presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  public override async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  // Both encodings from one digest: the header wants base64, `StoredObject` wants
  // hex, and hashing twice or round-tripping through hex buys nothing.
  private static async sha256(body: Uint8Array): Promise<Digest> {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
    return {
      hex: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      base64: Buffer.from(bytes).toString("base64"),
    };
  }
}
