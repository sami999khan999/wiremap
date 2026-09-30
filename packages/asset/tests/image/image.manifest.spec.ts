import { describe, expect, it } from "vitest";
import { ImageManifest } from "../../src/image/image.manifest.js";

describe("ImageManifest", () => {
  it("resolves a key to a fingerprinted src with dimensions and alt", () => {
    const logo = ImageManifest.get("brand.logo");

    expect(logo.src).toBeTruthy();
    expect(logo.width).toBe(160);
    expect(logo.height).toBe(40);
    expect(logo.alt).toBeTruthy();
  });

  it("gives every entry the four fields layout needs", () => {
    // `width`/`height` are what reserve the box before the bytes arrive. An entry
    // missing them is layout shift that nobody notices until a Lighthouse run.
    for (const key of ImageManifest.keys()) {
      const asset = ImageManifest.get(key);
      expect(typeof asset.src).toBe("string");
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.height).toBeGreaterThan(0);
      expect(asset.alt.length).toBeGreaterThan(0);
    }
  });

  it("narrows a known key", () => {
    expect(ImageManifest.isKnown("brand.logo")).toBe(true);
  });

  it("rejects an unknown one", () => {
    expect(ImageManifest.isKnown("home.hero")).toBe(false);
  });

  it("does not admit a prototype member", () => {
    // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so `"toString"` would
    // pass the guard and `get()` would hand back a function.
    expect(ImageManifest.isKnown("toString")).toBe(false);
    expect(ImageManifest.isKnown("constructor")).toBe(false);
  });
});
