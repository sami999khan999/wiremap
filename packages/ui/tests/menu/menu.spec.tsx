import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "../../src/menu/menu.js";

const OPTIONS = [
  { value: "guide", label: "Guide", description: "How to" },
  { value: "api", label: "API" },
  { value: "cli", label: "CLI" },
] as const;

const mount = () => {
  const onSelect = vi.fn();
  render(<Menu label="Space" value="api" options={OPTIONS} onSelect={onSelect} />);
  return onSelect;
};

const trigger = () => screen.getByRole("button", { name: "Space: API" });

describe("Menu", () => {
  it("names the trigger after the selected option", () => {
    mount();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens a listbox with the selected option marked", () => {
    mount();
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("API");
  });

  it("moves with the arrow keys and chooses with Enter", () => {
    const onSelect = mount();
    fireEvent.click(trigger());
    const list = screen.getByRole("listbox");

    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("cli");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("chooses on a click", () => {
    const onSelect = mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: /Guide/ }));
    expect(onSelect).toHaveBeenCalledWith("guide");
  });

  it("closes on Escape without choosing", () => {
    const onSelect = mount();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
