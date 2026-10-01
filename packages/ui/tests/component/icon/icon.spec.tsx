import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "../../../src/component/icon/icon.js";

const svgOf = (container: HTMLElement) => container.querySelector("svg");

describe("Icon", () => {
  it("references the sprite by fragment", () => {
    const { container } = render(<Icon name="check" />);

    expect(svgOf(container)?.querySelector("use")?.getAttribute("href")).toMatch(/#check$/);
  });

  it("hides itself from assistive tech with no label", () => {
    // Most icons sit next to text that already says what they mean; announcing them
    // again is noise.
    const svg = svgOf(render(<Icon name="check" />).container);

    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
  });

  it("becomes its own accessible name when labelled", () => {
    // An icon-only button passes `label` and the icon is the button's name.
    const svg = svgOf(render(<Icon name="user" label="Account" />).container);

    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Account");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
  });

  it("stays out of the tab order", () => {
    expect(svgOf(render(<Icon name="check" />).container)?.getAttribute("focusable")).toBe("false");
  });

  it("inherits colour rather than declaring it", () => {
    // `currentColor` is what makes a theme recolour the whole icon set with no
    // per-theme variants and no JavaScript.
    expect(svgOf(render(<Icon name="check" />).container)?.getAttribute("fill")).toBe(
      "currentColor",
    );
  });

  it("defaults to 20 and takes a size", () => {
    expect(svgOf(render(<Icon name="check" />).container)?.getAttribute("width")).toBe("20");
    expect(svgOf(render(<Icon name="check" size={32} />).container)?.getAttribute("width")).toBe(
      "32",
    );
  });
});
