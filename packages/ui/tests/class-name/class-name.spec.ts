import { describe, expect, it } from "vitest";
import { cn } from "../../src/class-name/index.js";

describe("cn", () => {
  it("joins conditional classes and drops falsy ones", () => {
    expect(cn("ui-button", false && "hidden", undefined, { "ui-button--ghost": true })).toBe(
      "ui-button ui-button--ghost",
    );
  });

  it("lets the later utility of a conflicting pair win", () => {
    expect(cn("p-2 bg-surface", "p-4")).toBe("bg-surface p-4");
    expect(cn("bg-surface", "bg-primary")).toBe("bg-primary");
  });

  // The theme's names are not Tailwind's defaults. A size and a colour must both survive.
  it("keeps a font size and a text colour side by side", () => {
    expect(cn("text-sm", "text-fg-muted")).toBe("text-sm text-fg-muted");
    expect(cn("text-primary-fg", "text-xl")).toBe("text-primary-fg text-xl");
  });
});
