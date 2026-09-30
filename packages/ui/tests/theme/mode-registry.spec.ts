import { describe, expect, it } from "vitest";
import { ModeRegistry } from "../../src/theme/mode-registry.js";

describe("ModeRegistry", () => {
  it("names both modes and defaults to light", () => {
    expect(ModeRegistry.all()).toEqual(["light", "dark"]);
    expect(ModeRegistry.DEFAULT).toBe("light");
  });

  it("sets both the attribute and the colour scheme", () => {
    // `colorScheme` is what makes native scrollbars, form controls and date pickers
    // match. Without it a dark theme has light scrollbars.
    const root = document.createElement("html");
    ModeRegistry.apply(root, "dark");

    expect(root.dataset.mode).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("resolves system against the supplied preference, never matchMedia", () => {
    expect(ModeRegistry.resolve("system", true)).toBe("dark");
    expect(ModeRegistry.resolve("system", false)).toBe("light");
  });

  it("lets an explicit choice outrank the operating system", () => {
    expect(ModeRegistry.resolve("light", true)).toBe("light");
    expect(ModeRegistry.resolve("dark", false)).toBe("dark");
  });

  it("separates a stored preference from a renderable mode", () => {
    expect(ModeRegistry.isPreference("system")).toBe(true);
    expect(ModeRegistry.isKnown("system")).toBe(false);
  });

  it("does not admit a prototype member", () => {
    expect(ModeRegistry.isKnown("toString")).toBe(false);
    expect(ModeRegistry.isPreference("constructor")).toBe(false);
  });
});
