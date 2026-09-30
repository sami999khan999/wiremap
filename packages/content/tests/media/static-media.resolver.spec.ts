import { ImageManifest } from "@loadbearing/asset";
import { describe, expect, it } from "vitest";
import { MediaResolver } from "../../src/media/media-ref.js";
import { StaticMediaResolver } from "../../src/media/static-media.resolver.js";

describe("StaticMediaResolver", () => {
  it("resolves a key to the manifest entry", () => {
    expect(new StaticMediaResolver().resolve("brand.logo")).toEqual(
      ImageManifest.get("brand.logo"),
    );
  });

  it("returns the four fields a renderer needs", () => {
    // `width`/`height` reach an `<img>` to reserve the box; `alt` is not optional.
    const media = new StaticMediaResolver().resolve("brand.logo");

    expect(typeof media.src).toBe("string");
    expect(media.width).toBeGreaterThan(0);
    expect(media.height).toBeGreaterThan(0);
    expect(media.alt.length).toBeGreaterThan(0);
  });

  it("is a MediaResolver, so a CdnMediaResolver is a drop-in", () => {
    expect(new StaticMediaResolver()).toBeInstanceOf(MediaResolver);
  });
});
