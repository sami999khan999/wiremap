import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResizablePanels } from "../../../src/component/resizable-panels/resizable-panels.js";

describe("ResizablePanels", () => {
  it("moves a divider with the arrow keys, within its bounds", () => {
    render(
      <ResizablePanels
        start={<p>roles</p>}
        end={<p>overview</p>}
        min={180}
        max={300}
        defaultStart={240}
      >
        <p>canvas</p>
      </ResizablePanels>,
    );
    const left = screen.getByRole("separator", { name: "Resize the left panel" });

    fireEvent.keyDown(left, { key: "ArrowRight" });
    expect(left.getAttribute("aria-valuenow")).toBe("256");

    fireEvent.keyDown(left, { key: "End" });
    expect(left.getAttribute("aria-valuenow")).toBe("300");

    fireEvent.keyDown(left, { key: "ArrowRight" });
    expect(left.getAttribute("aria-valuenow")).toBe("300");
  });

  // The right panel grows leftwards, so the arrow that widens it is the opposite one.
  it("widens the right panel with ArrowLeft", () => {
    render(
      <ResizablePanels end={<p>overview</p>} defaultEnd={320}>
        <p>canvas</p>
      </ResizablePanels>,
    );
    const right = screen.getByRole("separator", { name: "Resize the right panel" });

    fireEvent.keyDown(right, { key: "ArrowLeft" });
    expect(right.getAttribute("aria-valuenow")).toBe("336");
  });
});
