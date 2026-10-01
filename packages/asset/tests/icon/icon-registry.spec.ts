import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, IconRegistry } from "../../src/icon/icon-registry.js";

const SVG_DIR = join(import.meta.dirname, "../../src/icon/svg");
const SPRITE = join(import.meta.dirname, "../../src/icon/sprite.svg");

const sourceNames = (): readonly string[] =>
  readdirSync(SVG_DIR)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => basename(file, ".svg"))
    .sort();

describe("the generated registry", () => {
  // The assertion that matters: someone drops an icon in `svg/` and forgets to rebuild,
  // and `IconName` silently disagrees with what the sprite can actually render.
  it("names exactly the files in svg/", () => {
    expect([...ICON_NAMES]).toEqual(sourceNames());
  });

  it("is sorted, so the diff on an addition is one line", () => {
    expect([...ICON_NAMES]).toEqual([...ICON_NAMES].sort());
  });
});

describe("IconRegistry", () => {
  it("returns the full set", () => {
    expect(IconRegistry.all()).toEqual(ICON_NAMES);
  });

  it("narrows a known name", () => {
    expect(IconRegistry.isKnown("check")).toBe(true);
  });

  it("rejects an unknown one", () => {
    expect(IconRegistry.isKnown("definitely-not-an-icon")).toBe(false);
  });
});

describe("the sprite", () => {
  const sprite = readFileSync(SPRITE, "utf8");

  it("carries one symbol per registered name", () => {
    for (const name of ICON_NAMES) {
      expect(sprite).toContain(`<symbol id="${name}"`);
    }
    expect(sprite.match(/<symbol /g) ?? []).toHaveLength(ICON_NAMES.length);
  });

  it("gives every symbol a viewBox", () => {
    // A symbol without one has no coordinate system and renders at whatever size the
    // first `<use>` implies — which differs per call site.
    const symbols = sprite.match(/<symbol [^>]*>/g) ?? [];
    for (const symbol of symbols) {
      expect(symbol).toMatch(/viewBox="/);
    }
  });

  // `<Icon>` sets `fill="currentColor"` on its `<svg>`, so a symbol that does not say
  // `fill="none"` itself turns every outline into a filled shape: `key` drew as a dot.
  it("keeps each outline icon unfilled whatever the <use> element sets", () => {
    const symbols = sprite.match(/<symbol [^>]*>/g) ?? [];
    for (const symbol of symbols) {
      expect(symbol).toMatch(/fill="none"/);
      expect(symbol).toMatch(/stroke="currentColor"/);
    }
  });

  it("hardcodes no colour", () => {
    // The same rule build-sprite.mjs enforces, asserted on the output rather than the
    // input — so a change to the extraction that let one through still fails here.
    expect(sprite).not.toMatch(/(fill|stroke)=["'](?!none|currentColor)[^"']+["']/);
  });

  it("is hidden, so dropping it in the DOM renders nothing", () => {
    expect(sprite).toContain('style="display:none"');
  });
});
