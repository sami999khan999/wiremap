import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../../src/component/sidebar/sidebar.js";

describe("Sidebar", () => {
  it("is a named region holding its slots, with no backdrop while closed", () => {
    render(
      <Sidebar label="Docs" header={<p>head</p>} footer={<p>foot</p>} closeLabel="Close">
        <p>body</p>
      </Sidebar>,
    );
    expect(screen.getByRole("complementary", { name: "Docs" }).textContent).toBe("headbodyfoot");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("closes an open drawer from the backdrop and from Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Sidebar label="Docs" open onOpenChange={onOpenChange} closeLabel="Close">
        <p>body</p>
      </Sidebar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
