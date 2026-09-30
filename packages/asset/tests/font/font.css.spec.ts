import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/font");
const CSS = readFileSync(resolve(FONT_DIR, "font.css"), "utf8");

// The same strip `build-sprite.mjs` does: the file documents the block to add by showing
// one, and a check that reads its own instructions reports a face nobody declared.
const declared = [
  ...CSS.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/url\(["']?([^"')]+)["']?\)/g),
]
  .map((match) => match[1] ?? "")
  .map((href) => href.split("?")[0] ?? "");

describe("font.css", () => {
  // The regression guard: it declared Inter and JetBrains Mono against files that were
  // never committed, so every cold load spent a request on a 404 per face.
  it("declares no face whose file is absent", () => {
    const missing = declared.filter((href) => !existsSync(resolve(FONT_DIR, href)));

    expect(missing).toEqual([]);
  });

  it("keeps the block to add where someone adding a font will read it", () => {
    expect(CSS).toContain("font-display: swap");
    expect(CSS).toContain("woff2-variations");
  });
});
