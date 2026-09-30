import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const trigger = () => screen.getByRole("combobox", { name: "Space: API" });

// Base UI moves focus to the highlighted option a tick after opening.
const open = async () => {
  fireEvent.click(trigger());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

// A whole press: Base UI selects on the click that ends it.
const press = (element: Element) => {
  fireEvent.pointerDown(element);
  fireEvent.mouseDown(element);
  fireEvent.pointerUp(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
};

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

  it("moves with the arrow keys and chooses with Enter", async () => {
    const onSelect = mount();
    await open();

    fireEvent.keyDown(document.activeElement ?? document, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? document, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("cli");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("chooses on a click", async () => {
    const onSelect = mount();
    await open();
    press(screen.getByRole("option", { name: /Guide/ }));
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
