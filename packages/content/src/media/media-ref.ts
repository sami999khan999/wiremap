import type { ImageKey } from "../import.js";

export interface ResolvedMedia {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

// The seam a CDN or a per-tenant asset store slots into. Content records hold
// `"brand.logo"`, never a path, so the swap is this class and nothing above it.
export abstract class MediaResolver {
  public abstract resolve(key: ImageKey): ResolvedMedia;
}
