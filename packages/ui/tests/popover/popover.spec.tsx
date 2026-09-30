import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Popover } from "../../src/popover/popover.js";

const open = () => fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

// A whole press, not one event: Base UI dismisses on the click that ends it.
const press = (element: Element) => {
  fireEvent.pointerDown(element);
  fireEvent.mouseDown(element);
  fireEvent.pointerUp(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
};

const panel = () => screen.queryByRole("dialog", { name: "Notifications" });

const mount = () =>
  render(
    <div>
      <Popover label="Notifications" trigger={<span>bell</span>}>
        <p>Nothing new.</p>
      </Popover>
      <button type="button">elsewhere</button>
    </div>,
  );

describe("Popover", () => {
  // Unmounted, not hidden: the panel's content is a query in every real caller, and a
  // hidden one would fetch on every page that renders the trigger.
  it("renders no panel until it is opened", () => {
    mount();

    expect(panel()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Notifications" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("opens on the trigger and names the panel the same thing", () => {
    mount();
    open();

    expect(panel()).not.toBeNull();
    expect(screen.getByText("Nothing new.")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Notifications" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  // `aria-controls` names an element that exists. Pointing at an id that is not in the
  // document is worse than not pointing at all.
  it("points `aria-controls` at the panel only while there is one", () => {
    mount();
    const trigger = screen.getByRole("button", { name: "Notifications" });

    expect(trigger.getAttribute("aria-controls")).toBeNull();
    open();
    expect(trigger.getAttribute("aria-controls")).toBe(panel()?.getAttribute("id"));
  });

  it("closes on the trigger again", () => {
    mount();
    open();
    open();

    expect(panel()).toBeNull();
  });

  // Focus moves into the panel on open; without the return, the next Tab starts from the
  // top of the page. Base UI restores it a tick after the close, hence the wait.
  it("closes on Escape, and gives the trigger its focus back", async () => {
    mount();
    open();

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });

    expect(panel()).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Notifications" })),
    );
  });

  it("closes on a press outside it", () => {
    mount();
    open();

    press(screen.getByRole("button", { name: "elsewhere" }));

    expect(panel()).toBeNull();
  });

  it("stays open for a press inside it", () => {
    mount();
    open();

    press(screen.getByText("Nothing new."));

    expect(panel()).not.toBeNull();
  });

  // The header-bar case, and the reason `align` exists: a panel hanging off the right
  // edge of its trigger is the only one that stays on screen when the trigger is last.
  it("aligns to the end unless asked otherwise", () => {
    mount();
    open();
    expect(panel()?.className).toContain("ui-popover__panel--end");

    render(
      <Popover label="Start" trigger={<span>x</span>} align="start">
        <p>left</p>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(screen.getByRole("dialog", { name: "Start" }).className).toContain(
      "ui-popover__panel--start",
    );
  });
});
