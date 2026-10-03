import type { GraphDocument } from "../import.js";

// Reads an uploaded graph back: gunzipped, size-capped and schema-checked. Null for a file
// that is missing, too large, or not a version this server reads, with the reason.
export abstract class GraphArchive {
  public abstract read(
    key: string,
  ): Promise<
    { readonly document: GraphDocument; readonly bytes: number } | { readonly refused: string }
  >;
}
