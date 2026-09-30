import { describe, expect, it } from "vitest";
import { FontRegistry } from "../../src/theme/font-registry.js";
import { ThemeRegistry } from "../../src/theme/theme-registry.js";

describe("ThemeRegistry", () => {
  it("names every palette the stylesheet declares", () => {
    expect(ThemeRegistry.all()).toEqual([
      "slate",
      "ocean",
      "forest",
      "plum",
      "midnight",
      "graphite",
    ]);
  });

  it("defaults to the palette that also seeds :root", () => {
    expect(ThemeRegistry.DEFAULT).toBe("slate");
  });

  it("sets the theme attribute and nothing else", () => {
    // The mode is ModeRegistry's to set, so switching palette leaves it untouched.
    const root = document.createElement("html");
    root.dataset.mode = "dark";
    ThemeRegistry.apply(root, "ocean");

    expect(root.dataset.theme).toBe("ocean");
    expect(root.dataset.mode).toBe("dark");
  });

  it("does not admit a prototype member", () => {
    // `Object.hasOwn`, not `in`. This guard is what a stored preference crosses, so
    // `"toString"` passing it would make `meta()` return a function.
    expect(ThemeRegistry.isKnown("toString")).toBe(false);
    expect(ThemeRegistry.isKnown("constructor")).toBe(false);
    expect(ThemeRegistry.isKnown("ocean")).toBe(true);
    expect(ThemeRegistry.isKnown("solarized")).toBe(false);
  });

  it("reports which modes a palette ships", () => {
    expect(ThemeRegistry.supports("slate", "light")).toBe(true);
    expect(ThemeRegistry.supports("midnight", "light")).toBe(false);
    expect(ThemeRegistry.supports("midnight", "dark")).toBe(true);
  });

  it("never resolves a palette to a mode it has no block for", () => {
    // A dark-only palette rendered light matches no selector, which is a page with
    // every colour undefined. This is the call that stops that pair reaching the DOM.
    expect(ThemeRegistry.resolveMode("midnight", "light")).toBe("dark");
    expect(ThemeRegistry.resolveMode("midnight", "dark")).toBe("dark");
    expect(ThemeRegistry.resolveMode("ocean", "light")).toBe("light");
  });

  it("declares a mode list for every palette", () => {
    for (const key of ThemeRegistry.all()) {
      expect(ThemeRegistry.meta(key).modes.length).toBeGreaterThan(0);
    }
  });
});

describe("FontRegistry", () => {
  it("overrides the token rather than restyling anything", () => {
    const root = document.createElement("html");
    FontRegistry.apply(root, "mono");

    expect(root.style.getPropertyValue("--font-sans")).toBe(FontRegistry.meta("mono").stack);
  });

  it("ships a full stack per face, fallbacks included", () => {
    for (const key of FontRegistry.all()) {
      expect(FontRegistry.meta(key).stack).toContain(",");
    }
  });

  it("does not admit a prototype member either", () => {
    expect(FontRegistry.isKnown("valueOf")).toBe(false);
  });
});
