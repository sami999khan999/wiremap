import brandLogo from "./file/brand/logo.svg";

export interface ImageAsset {
  readonly src: string;
  // Not decoration. `width` and `height` on an `<img>` are what reserve the box before
  // the bytes arrive, and storing them beside the file is what stops them drifting.
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

// The bundler fingerprints each import, so `src` is a content-hashed URL that can be
// cached forever and invalidates itself when the file changes.
const IMAGES = {
  "brand.logo": { src: brandLogo, width: 160, height: 40, alt: "Wiremap" },
} as const satisfies Record<string, ImageAsset>;

export type ImageKey = keyof typeof IMAGES;

export class ImageManifest {
  private constructor() {}

  public static get(key: ImageKey): ImageAsset {
    return IMAGES[key];
  }

  public static keys(): readonly ImageKey[] {
    return Object.keys(IMAGES) as ImageKey[];
  }

  // `Object.hasOwn`, not `in` — `in` walks the prototype chain and admits `toString`.
  public static isKnown(value: string): value is ImageKey {
    return Object.hasOwn(IMAGES, value);
  }
}
