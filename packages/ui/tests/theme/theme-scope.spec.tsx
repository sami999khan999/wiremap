import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Popover } from "../../src/component/popover/popover.js";
import { ThemeScope } from "../../src/theme/theme-scope.js";

describe("ThemeScope", () => {
  // A portal on <body> would leave the scope and paint in the page's theme instead.
  it("keeps a portaled panel inside the scoped theme", () => {
    const { container } = render(
      <ThemeScope theme="ocean" mode="dark">
        <Popover label="Notifications" trigger={<span>bell</span>}>
          <p>Nothing new.</p>
        </Popover>
      </ThemeScope>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    const scope = container.querySelector('[data-theme="ocean"][data-mode="dark"]');
    expect(scope?.contains(screen.getByRole("dialog", { name: "Notifications" }))).toBe(true);
  });
});
