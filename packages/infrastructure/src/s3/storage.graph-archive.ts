import {
  GraphArchive,
  GraphContract,
  type GraphDocument,
  gunzipSync,
  type StorageGateway,
} from "../import.js";

// Reads an uploaded graph back through the storage port. The size is checked before the
// bytes are fetched and the expansion is capped, so a hostile upload costs one HEAD.
export class StorageGraphArchive extends GraphArchive {
  public static readonly MAX_GZIPPED = 25 * 1024 * 1024;
  private static readonly MAX_EXPANDED = 400 * 1024 * 1024;

  public constructor(private readonly storage: StorageGateway) {
    super();
  }

  public override async read(
    key: string,
  ): Promise<
    { readonly document: GraphDocument; readonly bytes: number } | { readonly refused: string }
  > {
    const size = await this.storage.sizeOf(key);
    if (size === null) return { refused: "No graph was uploaded." };
    if (size > StorageGraphArchive.MAX_GZIPPED)
      return { refused: "The graph is larger than 25 MB compressed." };
    let text: string;
    try {
      text = gunzipSync(await this.storage.get(key), {
        maxOutputLength: StorageGraphArchive.MAX_EXPANDED,
      }).toString("utf8");
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
    return { document: parsed.data, bytes: size };
  }
}
