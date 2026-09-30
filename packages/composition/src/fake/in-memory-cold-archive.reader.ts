import {
  ColdArchiveReader,
  type ColdPage,
  ConflictError,
  OrdinalCursor,
  type PartitionArchiveEntry,
  type UserId,
} from "../import.js";

// Rows staged by object key, checking the **row count** and not the checksum: the
// in-memory gateway's checksum is `fake-<key>`, so verifying it would test the fake.
export class InMemoryColdArchiveReader extends ColdArchiveReader {
  private readonly objects = new Map<string, readonly Readonly<Record<string, unknown>>[]>();

  public stage(objectKey: string, rows: readonly Readonly<Record<string, unknown>>[]): void {
    this.objects.set(objectKey, rows);
  }

  public override async *batches(
    entry: PartitionArchiveEntry,
    size: number,
  ): AsyncGenerator<readonly Readonly<Record<string, unknown>>[]> {
    const rows = await this.rows(entry);
    for (let at = 0; at < rows.length; at += size) yield rows.slice(at, at + size);
  }

  private rows(
    entry: PartitionArchiveEntry,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const rows = this.objects.get(entry.objectKey);
    if (!rows) return Promise.reject(new ConflictError("cold", "missing"));
    if (rows.length !== entry.rowCount) {
      return Promise.reject(new ConflictError("cold", "row-count"));
    }

    return Promise.resolve(rows);
  }

  // The same filter and slice the real one does, over the staged rows: a fake that
  // paged without filtering would let a use-case reading another user's rows pass.
  public override async page(
    entry: PartitionArchiveEntry,
    userId: UserId,
    cursor: string | null,
    limit: number,
  ): Promise<ColdPage> {
    // The real encoder, not a second one: a fake with its own cursor format would let
    // a round trip through the wire pass here and fail in production.
    const from = OrdinalCursor.decode(cursor) ?? 0;
    const mine = (await this.rows(entry)).filter((row) => row.user_id === userId);

    const items = mine.slice(from, from + limit);
    const next = from + items.length;

    return { items, nextCursor: next < mine.length ? OrdinalCursor.encode(next) : null };
  }
}
