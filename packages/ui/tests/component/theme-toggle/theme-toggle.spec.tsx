import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../../../src/component/theme-toggle/theme-toggle.js";

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
    const onModeChange = vi.fn();
    render(
      <ThemeToggle
        label="Mode"
        mode="dark"
        onModeChange={onModeChange}
        lightLabel="Light"
        darkLabel="Dark"
        disabledModes={["light"]}
      />,
    );
    const light = screen.getByRole("radio", { name: "Light" });

    expect(light.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(light);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  // A radio group moves with the arrow keys, which the hand-rolled segments never did.
  it("moves between the modes with the arrow keys", async () => {
    const onModeChange = vi.fn();
    render(
      <ThemeToggle
        label="Mode"
        mode="light"
        onModeChange={onModeChange}
        lightLabel="Light"
        darkLabel="Dark"
      />,
    );
    const light = screen.getByRole("radio", { name: "Light" });

    act(() => light.focus());
    fireEvent.keyDown(light, { key: "ArrowRight" });

    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith("dark"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Dark");
  });
});

describe("ThemeToggle with a system segment", () => {
  it("shows the stored preference as chosen and reports system as a preference", () => {
    const onPreferenceChange = vi.fn();
    const onModeChange = vi.fn();
    render(
      <ThemeToggle
        label="Mode"
        mode="dark"
        onModeChange={onModeChange}
        lightLabel="light"
        darkLabel="dark"
        variant="labels"
        system={{ label: "system", preference: "system", onPreferenceChange }}
      />,
    );

    expect(screen.getByRole("radio", { name: "system" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("light")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "light" }));
    expect(onPreferenceChange).toHaveBeenCalledWith("light");
    expect(onModeChange).not.toHaveBeenCalled();
  });
});
