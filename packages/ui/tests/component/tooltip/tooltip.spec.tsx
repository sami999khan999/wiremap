import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tooltip } from "../../../src/component/tooltip/tooltip.js";

describe("Tooltip", () => {
  // Supplementary: the trigger keeps its own name, and the hint appears on focus too.
  it("shows its label on focus without renaming the trigger", async () => {
    render(
      <Tooltip label="Copies the link">
        <button type="button" aria-label="Copy">
          ⧉
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Copy" });

    act(() => trigger.focus());
    fireEvent.focus(trigger);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByText("Copies the link")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy" })).toBe(trigger);
  });
});
