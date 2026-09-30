import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../../src/theme-toggle/theme-toggle.js";

describe("ThemeToggle", () => {
  it("checks the current mode and reports a change", () => {
    const onModeChange = vi.fn();
    render(
      <ThemeToggle
        label="Mode"
        mode="dark"
        onModeChange={onModeChange}
        lightLabel="Light"
        darkLabel="Dark"
      />,
    );
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(onModeChange).toHaveBeenCalledWith("light");
  });

  // A dark-only palette: the control keeps its shape, and the light half cannot be chosen.
  it("disables a mode the palette does not ship", () => {
    render(
      <ThemeToggle
        label="Mode"
        mode="dark"
        onModeChange={() => {}}
        lightLabel="Light"
        darkLabel="Dark"
        disabledModes={["light"]}
      />,
    );
    expect(screen.getByRole("radio", { name: "Light" }).hasAttribute("disabled")).toBe(true);
  });
});
