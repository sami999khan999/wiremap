import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoleDot } from "../../../src/component/role-dot/role-dot.js";

describe("RoleDot", () => {
  // Decoration beside a label that already names the role.
  it("is hidden from assistive technology", () => {
    const { container } = render(<RoleDot tone="primary" />);

    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  // Every tone is a token or a mix of two, never a literal colour.
  it("paints every tone from the twelve", () => {
    for (const tone of RoleDot.tones) {
      const { container } = render(<RoleDot tone={tone} />);
      const className = container.firstElementChild?.className ?? "";
      expect(className).toMatch(
        /bg-(primary|success|warning|fg-muted|\[color-mix\(in_oklch,var\(--)/,
      );
      expect(className).not.toMatch(/#|rgb|hsl/);
    }
  });
});
