import type { GraphDocument } from "../import.js";

export type ArchiveRead =
  | { readonly document: GraphDocument; readonly bytes: number }
  | { readonly refused: string };

// Reads a graph back: gunzipped, size-capped and schema-checked, or refused with the reason
// (missing, too large, not a version this server reads).
export abstract class GraphArchive {
  public abstract read(key: string): Promise<ArchiveRead>;

  // Validates an upload and writes the same bytes to the graph key, which only the server
  // writes. The upload is deleted either way, so a later PUT to its link changes nothing.
  public abstract promote(uploadKey: string, graphKey: string): Promise<ArchiveRead>;
}
