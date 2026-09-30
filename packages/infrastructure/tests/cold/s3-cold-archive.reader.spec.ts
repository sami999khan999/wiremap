import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PartitionedTable } from "@loadbearing/application";
import { describe, expect, it } from "vitest";
import type {
  OrganizationId,
  PartitionArchiveEntry,
  StorageGateway,
  UserId,
} from "../../src/import.js";
import { S3ColdArchiveReader } from "../../src/s3/s3-cold-archive.reader.js";

const ORG = "01a0b3de-1b12-75e1-9a19-2de75ed70bc0" as OrganizationId;

// Bytes in a Map, and **the real digest**: the whole point of the reader is that it
// verifies, so a fake whose checksum was a placeholder would test nothing.
class FakeStorage {
  private readonly objects = new Map<string, Uint8Array>();

  // Returns the digest rather than a `StoredObject`, because the digest is the only
  // part a caller here stages onto an entry — the shape would be noise.
  public stage(key: string, body: Uint8Array): string {
    this.objects.set(key, body);
    return createHash("sha256").update(body).digest("hex");
  }

  public get(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    if (!body) return Promise.reject(new Error(`no object: ${key}`));
    return Promise.resolve(body);
  }

  // Three bytes a chunk, so a line, a multi-byte character and the gzip trailer all
  // straddle a boundary — the cases a reader that joined chunks wrongly would miss.
  public async *getStream(key: string): AsyncGenerator<Uint8Array> {
    const body = await this.get(key);
    for (let at = 0; at < body.length; at += 3) yield body.slice(at, at + 3);
  }
}

const ndjson = (rows: readonly Readonly<Record<string, unknown>>[]): Uint8Array =>
  gzipSync(Buffer.from(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8"));

const entry = (overrides: Partial<PartitionArchiveEntry> = {}): PartitionArchiveEntry => ({
  organizationId: ORG,
  tableName: PartitionedTable.ACTIVITY_LOG,
  period: "2032-05-01",
  objectKey: `cold/activity_log/2032/05/${ORG}.ndjson.gz`,
  rowCount: 2,
  bytes: 256,
  checksum: "",
  actionCounts: {},
  projectedAt: null,
  ...overrides,
});

const ROWS = [
  { id: "a", action: "task.created" },
  { id: "b", action: "task.archived" },
];

const readerFor = (storage: FakeStorage) =>
  new S3ColdArchiveReader(storage as unknown as StorageGateway);

const USER = "018f8c00-0000-7000-8000-000000000011" as UserId;

const all = async (reader: S3ColdArchiveReader, of: PartitionArchiveEntry, size = 10) => {
  const rows: unknown[] = [];
  for await (const batch of reader.batches(of, size)) rows.push(...batch);
  return rows;
};

describe("S3ColdArchiveReader", () => {
  it("gunzips the object and parses one row per line", async () => {
    const storage = new FakeStorage();
    const checksum = storage.stage(entry().objectKey, ndjson(ROWS));

    expect(await all(readerFor(storage), entry({ checksum }))).toEqual(ROWS);
  });

  // `CR.16`: a month is read a batch at a time, never whole, and in the order it was written.
  it("hands the rows out in batches of the size asked for", async () => {
    const storage = new FakeStorage();
    const rows = [...ROWS, { id: "c", action: "task.née" }];
    const checksum = storage.stage(entry().objectKey, ndjson(rows));
    const batches: unknown[] = [];

    for await (const batch of readerFor(storage).batches(entry({ checksum, rowCount: 3 }), 2)) {
      batches.push(batch);
    }

    expect(batches).toEqual([rows.slice(0, 2), rows.slice(2)]);
  });

  // The object survived its own upload check and rotted afterwards, which is exactly
  // what the index cannot tell you about — so the reader checks rather than trusts.
  it("refuses an object whose bytes do not match the recorded checksum", async () => {
    const storage = new FakeStorage();
    storage.stage(entry().objectKey, ndjson(ROWS));

    // Before the first batch: projected rows from an object found corrupt at its end
    // would already be in the derived store.
    await expect(all(readerFor(storage), entry({ checksum: "not-the-digest" }))).rejects.toThrow(
      "CONFLICT",
    );
  });

  // The other half of the same check. An object rewritten cleanly hashes correctly for
  // what it now holds; only the count says it is short.
  it("refuses an object with the wrong number of rows", async () => {
    const storage = new FakeStorage();
    const checksum = storage.stage(entry().objectKey, ndjson(ROWS.slice(0, 1)));

    await expect(all(readerFor(storage), entry({ checksum }))).rejects.toThrow("CONFLICT");
  });

  // Refused before it is fetched: a 500 MB object read whole would take the worker
  // down, and the index records the size precisely so this can be answered first.
  it("refuses an object past the whole-object bound without fetching it", async () => {
    const storage = new FakeStorage();

    await expect(
      readerFor(storage).page(entry({ bytes: 51 * 1024 * 1024 }), USER, null, 10),
    ).rejects.toThrow("CONFLICT");
  });
});

// `CR.16`. The page held the whole tenant-month to serve one user's rows; it now keeps only
// the page, and still refuses an object that fails its checksum before returning anything.
describe("S3ColdArchiveReader.page", () => {
  const OTHER = "018f8c00-0000-7000-8000-000000000099";
  const rows = [
    { id: "1", user_id: USER },
    { id: "2", user_id: OTHER },
    { id: "3", user_id: USER },
    { id: "4", user_id: USER },
    { id: "5", user_id: OTHER },
  ];

  it("pages through one user's rows and says where the next page starts", async () => {
    const storage = new FakeStorage();
    const checksum = storage.stage(entry().objectKey, ndjson(rows));
    const of = entry({ checksum, rowCount: rows.length });

    const first = await readerFor(storage).page(of, USER, null, 2);
    expect(first.items.map((row) => row.id)).toEqual(["1", "3"]);

    const second = await readerFor(storage).page(of, USER, first.nextCursor, 2);
    expect(second.items.map((row) => row.id)).toEqual(["4"]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns nothing from an object that fails its checksum", async () => {
    const storage = new FakeStorage();
    storage.stage(entry().objectKey, ndjson(rows));

    await expect(
      readerFor(storage).page(entry({ checksum: "wrong", rowCount: rows.length }), USER, null, 2),
    ).rejects.toThrow("CONFLICT");
  });
});
