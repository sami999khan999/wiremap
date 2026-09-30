import {
  ColdArchiveReader,
  type ColdPage,
  ConflictError,
  createHash,
  type PartitionArchiveEntry,
  type StorageGateway,
  type UserId,
} from "../import.js";
import { NdjsonLines } from "./ndjson-lines.js";
import { OrdinalCursor } from "./ordinal-cursor.js";

// The bound `21.1` states, with headroom, on what one request may read through. Past it the
// object is refused: "it was slow" is a worse failure than "it said no".
const MAX_BYTES = 50 * 1024 * 1024;

export class S3ColdArchiveReader extends ColdArchiveReader {
  public constructor(private readonly storage: StorageGateway) {
    super();
  }

  // Two passes over the object: the first proves it, the second parses it. One pass would
  // hand out rows from an object found to be corrupt only at its end.
  public async *batches(
    entry: PartitionArchiveEntry,
    size: number,
  ): AsyncGenerator<readonly Readonly<Record<string, unknown>>[]> {
    await this.verify(entry);

    let batch: Readonly<Record<string, unknown>>[] = [];
    for await (const line of NdjsonLines.of(this.storage.getStream(entry.objectKey))) {
      batch.push(JSON.parse(line) as Readonly<Record<string, unknown>>);
      if (batch.length < size) continue;
      yield batch;
      batch = [];
    }
    if (batch.length > 0) yield batch;
  }

  // **Against the compressed bytes**, because that is what the gateway hashed on the way
  // up. The count is the other half: a clean rewrite that is short hashes as itself.
  private async verify(entry: PartitionArchiveEntry): Promise<void> {
    const hash = createHash("sha256");
    let count = 0;
    for await (const _ of NdjsonLines.of(this.storage.getStream(entry.objectKey), hash)) {
      count += 1;
    }

    if (hash.digest("hex") !== entry.checksum) throw new ConflictError("cold", "checksum");
    if (count !== entry.rowCount) throw new ConflictError("cold", "row-count");
  }

  // One pass, verified at the end and before anything is returned, holding only the page:
  // the month streams past and this user's rows outside the window are counted, not kept.
  // ──
  // It held the whole tenant-month to serve one user's slice (`CR.16`). The cap stays as a
  // bound on the time a request may spend reading, which streaming does not shorten.
  public async page(
    entry: PartitionArchiveEntry,
    userId: UserId,
    cursor: string | null,
    limit: number,
  ): Promise<ColdPage> {
    if (entry.bytes > MAX_BYTES) {
      throw new ConflictError("cold", "too-large");
    }

    const from = OrdinalCursor.decode(cursor) ?? 0;
    const hash = createHash("sha256");
    const items: Readonly<Record<string, unknown>>[] = [];
    let lines = 0;
    let mine = 0;

    for await (const line of NdjsonLines.of(this.storage.getStream(entry.objectKey), hash)) {
      lines += 1;
      const row = JSON.parse(line) as Readonly<Record<string, unknown>>;
      if (row.user_id !== userId) continue;
      if (mine >= from && items.length < limit) items.push(row);
      mine += 1;
    }

    if (hash.digest("hex") !== entry.checksum) throw new ConflictError("cold", "checksum");
    if (lines !== entry.rowCount) throw new ConflictError("cold", "row-count");

    const next = from + items.length;
    return { items, nextCursor: next < mine ? OrdinalCursor.encode(next) : null };
  }
}
