import { type ImageKey, ImageManifest } from "../import.js";
import { MediaResolver, type ResolvedMedia } from "./media-ref.js";

// Reads the manifest `@loadbearing/asset` compiles. Synchronous, because the answer is
// already in the bundle — a `CdnMediaResolver` would be the same shape over a lookup table.
export class StaticMediaResolver extends MediaResolver {
  public override resolve(key: ImageKey): ResolvedMedia {
    return ImageManifest.get(key);
  }
}
