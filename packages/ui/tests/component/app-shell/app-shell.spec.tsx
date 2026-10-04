import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../../../src/component/app-shell/index.js";

const shell = (navigationKey = "/a") => (
  <AppShell
    sidebar={<a href="/projects">Projects</a>}
    brand={<span>wiremap</span>}
    sidebarLabel="Main navigation"
    openLabel="Open navigation"
    closeLabel="Close navigation"
    resizeLabel="Resize the sidebar"
    navigationKey={navigationKey}
  >
    <p>Page</p>
  </AppShell>
);

describe("AppShell", () => {
  it("widens and narrows the sidebar from the keyboard, within its bounds", () => {
    render(shell());
    const handle = screen.getByRole("separator", { name: "Resize the sidebar" });
    const width = () => Number(handle.getAttribute("aria-valuenow"));

    const start = width();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toBe(start + 16);
    fireEvent.keyDown(handle, { key: "End" });
    expect(width()).toBe(Number(handle.getAttribute("aria-valuemax")));
    fireEvent.keyDown(handle, { key: "Home" });
    expect(width()).toBe(Number(handle.getAttribute("aria-valuemin")));
  });

  it("opens as a drawer on a phone, and closes on Escape and on navigation", () => {
    const { rerender } = render(shell("/a"));
    const open = screen.getByRole("button", { name: "Open navigation" });

    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(open.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(open);
    rerender(shell("/b"));
    expect(open.getAttribute("aria-expanded")).toBe("false");
  });
});
