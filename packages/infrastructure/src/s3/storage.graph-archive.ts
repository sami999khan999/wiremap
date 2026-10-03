import {
  type ArchiveRead,
  GraphArchive,
  GraphContract,
  gunzipSync,
  type StorageGateway,
} from "../import.js";

type Fetched = { readonly bytes: Uint8Array } | { readonly refused: string };

// Graphs through the storage port. The read is streamed and stops at the size cap, so an
// object replaced with a huge one between two calls never reaches memory whole.
export class StorageGraphArchive extends GraphArchive {
  public static readonly MAX_GZIPPED = 25 * 1024 * 1024;
  private static readonly MAX_EXPANDED = 400 * 1024 * 1024;

  public constructor(private readonly storage: StorageGateway) {
    super();
  }

  public override async read(key: string): Promise<ArchiveRead> {
    const fetched = await this.fetch(key);
    return "refused" in fetched ? fetched : StorageGraphArchive.parse(fetched.bytes);
  }

  public override async promote(uploadKey: string, graphKey: string): Promise<ArchiveRead> {
    try {
      const fetched = await this.fetch(uploadKey);
      if ("refused" in fetched) return fetched;
      const read = StorageGraphArchive.parse(fetched.bytes);
      if ("document" in read) await this.storage.put(graphKey, fetched.bytes, "application/gzip");
      return read;
    } finally {
      await this.storage.delete(uploadKey).catch(() => undefined);
    }
  }

  private async fetch(key: string): Promise<Fetched> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of this.storage.getStream(key)) {
        size += chunk.byteLength;
        if (size > StorageGraphArchive.MAX_GZIPPED)
          return { refused: "The graph is larger than 25 MB compressed." };
        chunks.push(chunk);
      }
    } catch {
      return { refused: "No graph was uploaded." };
    }
    if (size === 0) return { refused: "No graph was uploaded." };
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { bytes };
  }

  private static parse(bytes: Uint8Array): ArchiveRead {
    let text: string;
    try {
      text = gunzipSync(bytes, { maxOutputLength: StorageGraphArchive.MAX_EXPANDED }).toString(
        "utf8",
      );
    } catch {
      return { refused: "The graph is not a gzip file, or expands past the limit." };
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { refused: "The graph is not JSON." };
    }
    const parsed = GraphContract.document.safeParse(value);
    if (!parsed.success) {
      const version = (value as { version?: unknown } | null)?.version;
      const foreign = typeof version === "number" && version !== 1;
      return {
        refused: foreign
          ? `This server reads graph version 1; the upload is version ${version}.`
          : "The graph does not match the expected format.",
      };
    }
    return { document: parsed.data, bytes: bytes.byteLength };
  }
}
